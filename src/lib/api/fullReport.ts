// src/lib/api/fullReport.ts
//
// Combined report: invoices (INV) + repairs (REP) + customer orders (ORD)
// + cash purchases (CP) as one flat list of rows.
//
// PERFORMANCE / SCALE
//  - Everything is fetched in ONE parallel round.
//  - The dashboard's already-loaded sales report is reused (`prefetched`).
//  - `.in('invoice_id', ids)` is split into chunks, so the request URL never
//    gets too long when a range has hundreds of bills.
//  - Range queries are paged (Supabase returns max 1000 rows per request),
//    so large ranges are no longer silently cut off.
//  - repair_orders is queried once and split in memory.

import { supabase } from '../supabaseClient';
import { getSalesReport, type ReportRange, type ReportSummary } from './reports';
import { displayNetWeight } from '../exchangeGold';

export type LineKind = 'inv' | 'rep' | 'ord' | 'cp';

export interface ReportLine {
    kind: LineKind;
    billNo: string;
    date: string;        // ISO or YYYY-MM-DD (sorting)
    customer: string;
    metal: string;
    product: string;
    weight: string;      // already formatted ('' = none)
    weightNum: number;   // numeric WT, used for the totals
    loc: string;         // remarks
    oldMetal: string;
    oldWeight: string;
    oldWeightNum: number; // numeric Old WT, used for the totals
    paid: number | null; // null = no amount on this row (multi-item bills)
    flow: 'in' | 'out';  // in = received from customer, out = paid to customer
    firstOfBill: boolean;
}

export interface FullReport {
    range: ReportRange;
    lines: ReportLine[];
    totals: {
        invoiceCount: number;
        repairCount: number;
        orderCount: number;
        purchaseCount: number;
        invoiceSales: number;
        invoiceReceived: number;
        repairReceived: number;
        orderReceived: number;
        totalReceived: number;
        purchasePaidOut: number;
        netCash: number;
    };
}

const num = (v: any) => Number(v) || 0;
// 2.500 -> "2.5 g", 10 -> "10 g", 4.22 -> "4.22 g"
const plainNum = (n: number) => String(Number(n.toFixed(3)));
const w3 = (n: number) => `${plainNum(n)} g`;

/** "CP-2026..." stays as is; "1023" becomes "REP-1023". */
function billLabel(prefix: string, no: unknown): string {
    const s = String(no ?? '').trim();
    if (!s) return prefix;
    return s.toUpperCase().startsWith(prefix + '-') ? s : `${prefix}-${s}`;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const r of rows) {
        const k = key(r);
        const list = m.get(k) ?? [];
        list.push(r);
        m.set(k, list);
    }
    return m;
}

const REMARK_KEYS = ['remarks', 'remark', 'notes', 'note', 'narration', 'comments'];
const EXCHANGE_TABLE = 'invoice_exchange_items';
// in case the old-gold items are stored as JSON on the invoice row itself
const EXCHANGE_JSON_KEYS = ['exchange_items', 'old_items', 'exchange_gold', 'old_gold_items', 'exchange'];

function pickText(row: any, keys: string[]): string {
    for (const k of keys) {
        const v = row?.[k];
        if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
}

function oldMetalLabel(ex: any): string {
    const metal = pickText(ex, ['metal_name', 'metal', 'metal_type']);
    const purity = pickText(ex, ['purity_name', 'purity_label', 'purity', 'claimed_purity']);
    return `${metal} ${purity}`.trim() || 'Old gold';
}

function oldWeightValue(ex: any): number {
    const gross = num(ex?.gross_weight ?? ex?.weight);
    if (gross > 0) {
        return displayNetWeight({ gross_weight: gross, stone_weight: num(ex?.stone_weight) });
    }
    return num(ex?.net_weight);
}

// ---------------------------------------------------------------------------
// Query helpers for large ranges
// ---------------------------------------------------------------------------
const IN_CHUNK = 60;       // ids per .in() request (keeps the URL short)
const IN_CONCURRENCY = 6;  // chunk requests running at the same time
const PAGE_SIZE = 1000;    // Supabase max rows per request

/** Run `fn` over `items` with at most `limit` running at once, keep order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** select * from table where column in (ids), in chunks. Never throws: returns the error. */
async function selectInChunks(
    table: string,
    column: string,
    ids: string[]
): Promise<{ data: any[]; error: { message: string } | null }> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));

    const results = await mapLimit(chunks, IN_CONCURRENCY, (c) =>
        supabase.from(table).select('*').in(column, c)
    );
    const failed = results.find((r) => r.error);
    return {
        data: results.flatMap((r) => r.data ?? []),
        error: failed?.error ? { message: failed.error.message } : null,
    };
}

/** Fetch every page of a range query (Supabase caps one response at 1000 rows). */
async function fetchAllPages(
    build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const res = await build(from, from + PAGE_SIZE - 1);
        if (res.error) throw res.error;
        const rows = res.data ?? [];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Invoice details (items + remarks + old-gold rows)
// ---------------------------------------------------------------------------
interface InvoiceDetails {
    itemsByInv: Map<string, any[]>;
    exchByInv: Map<string, any[]>;
    remarksByInv: Map<string, string>;
}

async function fetchInvoiceDetails(invoiceIds: string[]): Promise<InvoiceDetails> {
    let itemsByInv = new Map<string, any[]>();
    const exchByInv = new Map<string, any[]>();
    const remarksByInv = new Map<string, string>();

    if (!invoiceIds.length) return { itemsByInv, exchByInv, remarksByInv };

    const [items, invRows, exchRows] = await Promise.all([
        selectInChunks('invoice_items', 'invoice_id', invoiceIds),
        selectInChunks('invoices', 'id', invoiceIds),
        selectInChunks(EXCHANGE_TABLE, 'invoice_id', invoiceIds),
    ]);

    if (items.error) console.warn('[fullReport] invoice_items failed', items.error.message);
    itemsByInv = groupBy(items.data, (r: any) => r.invoice_id);

    // Invoice-level remarks, and old-gold items if stored as JSON on the invoice
    if (invRows.error) console.warn('[fullReport] invoices failed', invRows.error.message);
    for (const r of invRows.data) {
        remarksByInv.set(r.id, pickText(r, REMARK_KEYS));
        for (const k of EXCHANGE_JSON_KEYS) {
            if (Array.isArray(r[k]) && r[k].length) {
                exchByInv.set(r.id, r[k]);
                break;
            }
        }
    }

    // Old-gold rows from their own table (JSON on the invoice wins if present)
    if (exchRows.error) console.warn(`[fullReport] ${EXCHANGE_TABLE} failed`, exchRows.error.message);
    groupBy(exchRows.data, (r: any) => r.invoice_id).forEach((rows, id) => {
        if (!exchByInv.has(id)) exchByInv.set(id, rows);
    });

    return { itemsByInv, exchByInv, remarksByInv };
}

/**
 * @param range      date range of the report
 * @param prefetched the sales report the dashboard already loaded for the SAME range
 *                   (skips one full re-fetch). Optional.
 */
export async function getFullReport(range: ReportRange, prefetched?: ReportSummary): Promise<FullReport> {
    const fromIso = new Date(`${range.fromDate}T00:00:00`).toISOString();
    const toIso = new Date(`${range.toDate}T23:59:59.999`).toISOString();
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    const inRange = (v: unknown): boolean => {
        if (!v) return false;
        const t = new Date(String(v)).getTime();
        return t >= fromMs && t <= toMs;
    };

    const lines: ReportLine[] = [];

    // ------------------------------------------------------------------
    // ONE parallel round. Invoice details start as soon as the invoice ids
    // are known (instantly when `prefetched` is given).
    // ------------------------------------------------------------------
    const salesPromise: Promise<ReportSummary> = prefetched
        ? Promise.resolve(prefetched)
        : getSalesReport(range);
    const detailsPromise = salesPromise.then((s) => fetchInvoiceDetails(s.invoices.map((i) => i.id)));

    const [sales, details, repData, ordData, cpData] = await Promise.all([
        salesPromise,
        detailsPromise,
        // created in range OR delivered in range: one query instead of two
        fetchAllPages((f, t) =>
            supabase
                .from('repair_orders')
                .select('*')
                .or(
                    `and(created_at.gte.${fromIso},created_at.lte.${toIso}),` +
                    `and(delivered_at.gte.${fromIso},delivered_at.lte.${toIso})`
                )
                .order('created_at', { ascending: true })
                .range(f, t)
        ),
        fetchAllPages((f, t) =>
            supabase
                .from('customer_orders')
                .select('*, customer:customers(name)')
                .gte('created_at', fromIso)
                .lte('created_at', toIso)
                .order('created_at', { ascending: true })
                .range(f, t)
        ),
        fetchAllPages((f, t) =>
            supabase
                .from('cash_purchases')
                .select('*')
                .gte('created_at', fromIso)
                .lte('created_at', toIso)
                .order('created_at', { ascending: true })
                .range(f, t)
        ),
    ]);

    const { itemsByInv, exchByInv, remarksByInv } = details;
    const repCreated = repData.filter((r) => inRange(r.created_at));
    const repDelivered = repData.filter((r) => inRange(r.delivered_at));

    // ------------------------------------------------------------------
    // 1) INVOICES
    // ------------------------------------------------------------------
    for (const inv of sales.invoices) {
        const items = itemsByInv.get(inv.id) ?? [];
        const exch = exchByInv.get(inv.id) ?? [];
        const invRemarks = remarksByInv.get(inv.id) ?? '';
        const n = Math.max(items.length, exch.length, 1);

        for (let i = 0; i < n; i++) {
            const it = items[i];
            const ex = exch[i];

            const name = it ? String(it.product_name ?? it.name ?? '') : '';
            const code = it?.product_code ? String(it.product_code) : '';
            const product = [name, code && `(${code})`].filter(Boolean).join(' ') || (code || '—');
            const wt = it ? num(it.net_weight ?? it.gross_weight ?? it.weight) : 0;
            const oldWt = ex ? oldWeightValue(ex) : 0;

            // invoice remarks on the first row, item remarks on their own row
            const loc = [i === 0 ? invRemarks : '', it ? pickText(it, REMARK_KEYS) : '']
                .filter(Boolean)
                .join(' · ');

            lines.push({
                kind: 'inv',
                billNo: billLabel('', inv.invoice_number),
                date: inv.invoice_date,
                customer: inv.customer_name,
                metal: it ? String(it.metal_name ?? it.metal ?? '').trim() || '—' : '—',
                product,
                weight: wt > 0 ? w3(wt) : '',
                weightNum: wt,
                loc,
                oldMetal: ex ? oldMetalLabel(ex) : '',
                oldWeight: oldWt > 0 ? w3(oldWt) : '',
                oldWeightNum: oldWt,
                paid: i === 0 ? inv.paid_amount : null,
                flow: 'in',
                firstOfBill: i === 0,
            });
        }
    }

    // ------------------------------------------------------------------
    // 2) REPAIRS: advance when received, balance when delivered
    // ------------------------------------------------------------------
    let repairReceived = 0;
    const repairIds = new Set<string>();

    for (const r of repCreated) {
        repairIds.add(r.id);
        const advance = num(r.advance);
        repairReceived += advance;
        lines.push({
            kind: 'rep',
            billNo: billLabel('REP', r.receipt_no),
            date: r.created_at,
            customer: r.customer_name ?? '',
            metal: '—',
            product: String(r.item ?? ''),
            weight: r.weight != null && num(r.weight) > 0 ? w3(num(r.weight)) : '',
            weightNum: num(r.weight),
            loc: String(r.remarks ?? ''),
            oldMetal: '',
            oldWeight: '',
            oldWeightNum: 0,
            paid: advance,
            flow: 'in',
            firstOfBill: true,
        });
    }

    for (const r of repDelivered) {
        repairIds.add(r.id);
        const finalPay = num(r.final_payment);
        if (finalPay <= 0) continue;
        repairReceived += finalPay;
        lines.push({
            kind: 'rep',
            billNo: billLabel('REP', r.receipt_no),
            date: r.delivered_at,
            customer: r.customer_name ?? '',
            metal: '—',
            product: String(r.item ?? ''),
            weight: r.weight != null && num(r.weight) > 0 ? w3(num(r.weight)) : '',
            weightNum: 0, // already counted on the advance row
            loc: `Delivered, balance${r.final_payment_mode ? ` (${r.final_payment_mode})` : ''}`,
            oldMetal: '',
            oldWeight: '',
            oldWeightNum: 0,
            paid: finalPay,
            flow: 'in',
            firstOfBill: true,
        });
    }

    // ------------------------------------------------------------------
    // 3) CUSTOMER ORDERS: advance received when the order was placed
    // ------------------------------------------------------------------
    let orderReceived = 0;
    for (const o of ordData) {
        const adv = num(o.advance_amount);
        orderReceived += adv;
        const wMin = num(o.weight_min);
        const wMax = o.weight_max != null ? num(o.weight_max) : 0;
        lines.push({
            kind: 'ord',
            billNo: billLabel('ORD', o.order_number),
            date: o.created_at,
            customer: o.customer?.name ?? '',
            metal: `${o.metal ?? ''} ${o.purity ?? ''}`.trim() || '—',
            product: String(o.category ?? ''),
            weight:
                wMin > 0
                    ? wMax > 0 && wMax !== wMin
                        ? `${plainNum(wMin)}-${plainNum(wMax)} g`
                        : w3(wMin)
                    : '',
            weightNum: wMin,
            loc: [o.notes, o.due_date ? `Due ${o.due_date}` : ''].filter(Boolean).join(' · '),
            oldMetal: '',
            oldWeight: '',
            oldWeightNum: 0,
            paid: adv,
            flow: 'in',
            firstOfBill: true,
        });
    }

    // ------------------------------------------------------------------
    // 4) CASH PURCHASES: money paid OUT to the customer
    // ------------------------------------------------------------------
    let purchasePaidOut = 0;
    for (const p of cpData) {
        const paid = num(p.paid_amount ?? p.total_amount);
        purchasePaidOut += paid;
        const items: any[] = Array.isArray(p.items) && p.items.length ? p.items : [null];

        items.forEach((it, i) => {
            const oldWt = it
                ? displayNetWeight({ gross_weight: num(it.gross_weight), stone_weight: num(it.stone_weight) })
                : 0;
            lines.push({
                kind: 'cp',
                billNo: billLabel('CP', p.receipt_no),
                date: p.created_at,
                customer: p.customer_name ?? '',
                metal: '—',
                product: it ? String(it.name ?? '') : '',
                weight: '',
                weightNum: 0,
                loc: i === 0 ? String(p.remarks ?? '') : '',
                oldMetal: it ? `${it.metal_name ?? ''} ${it.purity_name ?? ''}`.trim() : '',
                oldWeight: it ? w3(oldWt) : '',
                oldWeightNum: oldWt,
                paid: i === 0 ? paid : null,
                flow: 'out',
                firstOfBill: i === 0,
            });
        });
    }

    // Order: INV, REP, ORD, CP. Within a group: oldest first, keep a bill's rows together.
    const kindOrder: Record<LineKind, number> = { inv: 0, rep: 1, ord: 2, cp: 3 };
    const indexed = lines.map((l, idx) => ({ l, idx }));
    indexed.sort(
        (a, b) =>
            kindOrder[a.l.kind] - kindOrder[b.l.kind] ||
            String(a.l.date).localeCompare(String(b.l.date)) ||
            a.idx - b.idx
    );

    const totalReceived = sales.totalCollected + repairReceived + orderReceived;

    return {
        range,
        lines: indexed.map((x) => x.l),
        totals: {
            invoiceCount: sales.totalInvoices,
            repairCount: repairIds.size,
            orderCount: ordData.length,
            purchaseCount: cpData.length,
            invoiceSales: sales.totalSales,
            invoiceReceived: sales.totalCollected,
            repairReceived,
            orderReceived,
            totalReceived,
            purchasePaidOut,
            netCash: totalReceived - purchasePaidOut,
        },
    };
}