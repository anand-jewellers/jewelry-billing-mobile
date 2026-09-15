import { supabase } from '../supabaseClient';
import type { DateFilterValue } from '../../components/ui/DateFilter';
import type { PaymentMode } from '../../types/invoices';

export interface ReportRange {
  fromDate: string;
  toDate: string;
  label: string;
}

function toYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveRange(value: DateFilterValue): ReportRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (value.mode) {
    case 'today':
      return { fromDate: toYMD(today), toDate: toYMD(today), label: 'Today' };
    case 'week': {
      const day = today.getDay();
      const diffToMonday = (day + 6) % 7;
      const start = new Date(today);
      start.setDate(today.getDate() - diffToMonday);
      return { fromDate: toYMD(start), toDate: toYMD(today), label: 'This Week' };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { fromDate: toYMD(start), toDate: toYMD(today), label: 'This Month' };
    }
    case 'particular': {
      const d = value.date ?? today;
      return { fromDate: toYMD(d), toDate: toYMD(d), label: `Date: ${toYMD(d)}` };
    }
    case 'custom': {
      const start = value.startDate ?? today;
      const end = value.endDate ?? start;
      return { fromDate: toYMD(start), toDate: toYMD(end), label: `${toYMD(start)} to ${toYMD(end)}` };
    }
  }
}

export interface ReportInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  payment_mode: PaymentMode;
  status: string;
  customer_name: string;
  product_codes: string[];
}

export interface PaymentBreakdownSlice {
  mode: PaymentMode;
  label: string;
  amount: number;
  color: string;
}

export interface ReportSummary {
  range: ReportRange;
  totalSales: number;
  totalInvoices: number;
  totalCollected: number;
  totalPending: number;
  invoices: ReportInvoiceRow[];
  paymentBreakdown: PaymentBreakdownSlice[];
}

// Fixed label + color per payment mode so the chart stays visually consistent
// across every date range instead of colors shuffling as data changes.
const PAYMENT_MODE_META: Record<PaymentMode, { label: string; color: string }> = {
  cash: { label: 'Cash', color: '#1E8E3E' },
  upi: { label: 'UPI', color: '#7C3AED' },
  card: { label: 'Card', color: '#2563EB' },
  bank_transfer: { label: 'Bank Transfer', color: '#EA8C00' },
  cheque: { label: 'Cheque', color: '#6B7280' },
};

export async function getSalesReport(range: ReportRange): Promise<ReportSummary> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, invoice_date, grand_total, paid_amount, balance_amount, payment_status, payment_mode, status, customer:customers(name), invoice_items(product_code)'
    )
    .gte('invoice_date', range.fromDate)
    .lte('invoice_date', range.toDate)
    .order('invoice_date', { ascending: false });

  if (error) throw error;

  const invoices: ReportInvoiceRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    grand_total: row.grand_total ?? 0,
    paid_amount: row.paid_amount ?? 0,
    balance_amount: row.balance_amount ?? 0,
    payment_status: row.payment_status,
    payment_mode: (row.payment_mode ?? 'cash') as PaymentMode,
    status: row.status,
    customer_name: row.customer?.name ?? 'Walk-in Customer',
    product_codes: (row.invoice_items ?? [])
      .map((item: any) => item.product_code)
      .filter(Boolean),
  }));

  // Sum *collected* amount (paid_amount) per payment method — this is what a
  // "how much cash/UPI/card did we actually take in" chart should reflect,
  // not grand_total (which could include an unpaid balance).
  const totalsByMode = new Map<PaymentMode, number>();
  for (const inv of invoices) {
    const prev = totalsByMode.get(inv.payment_mode) ?? 0;
    totalsByMode.set(inv.payment_mode, prev + inv.paid_amount);
  }

  const paymentBreakdown: PaymentBreakdownSlice[] = Array.from(totalsByMode.entries())
    .filter(([, amount]) => amount > 0)
    .map(([mode, amount]) => ({
      mode,
      label: PAYMENT_MODE_META[mode]?.label ?? mode,
      amount,
      color: PAYMENT_MODE_META[mode]?.color ?? '#999999',
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    range,
    totalSales: invoices.reduce((s, r) => s + r.grand_total, 0),
    totalInvoices: invoices.length,
    totalCollected: invoices.reduce((s, r) => s + r.paid_amount, 0),
    totalPending: invoices.reduce((s, r) => s + r.balance_amount, 0),
    invoices,
    paymentBreakdown,
  };
}