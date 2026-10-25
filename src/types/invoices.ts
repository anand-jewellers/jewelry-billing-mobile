//\src\types\invoices.ts

import type { CalculationType } from './settings';

export type ProductStatus = 'active' | 'inactive' | 'sold' | 'discontinued';

// 'split' is not a mode a cashier picks for a single payment row — it's the
// value stored on the invoice header when payment_splits.length > 1, so
// anything still reading the single `payment_mode` field knows to look at
// the breakdown instead of trusting one mode.
export type PaymentMode = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'credit' | 'split';

export interface Product {
  id: string;
  product_code: string;
  product_name: string;
  category_id: string | null;
  subcategory_id: string | null;
  metal_id: string;
  purity_id: string;
  gross_weight: number;
  stone_weight: number;
  other_weight: number;
  net_weight: number;
  metal_rate: number;
  making_charge_type: CalculationType;
  making_charge_value: number;
  discount: number;
  selling_price: number;
  huid: string | null;
  barcode: string | null;
  sku: string | null;
  status: ProductStatus;
  is_active: boolean;
  deleted_at: string | null;
}

export interface ValueAddedChargeLine {
  id: string;
  charge_type_id: string;
  name: string;
  calculation_type: CalculationType;
  value: number;
  amount: number;
}

export interface InvoiceItem {
  id: string;
  product_id: string | null;
  product_code: string | null;
  name: string;
  metal_id: string | null;
  purity_id: string | null;
  category_id: string | null;
  quantity: number;
  gross_weight: number;
  stone_weight: number;
  other_weight: number;
  net_weight: number;
  metal_rate: number;
  metal_value: number;
  making_charge_type: CalculationType;
  making_charge_value: number;
  making_charge_amount: number;
  value_added_charges: ValueAddedChargeLine[];
  item_discount: number;
  taxable_amount: number;
  tax_setting_id: string | null;
  tax_percentage: number;
  cgst_percentage: number;
  sgst_percentage: number;
  igst_percentage: number;
  tax_amount: number;
  total_amount: number;
  huid: string | null;
  gst_enabled?: boolean; //
  remark?: string | null;          // NEW: per-item LOC / remark
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

// One leg of a (possibly split) payment — e.g. ₹5000 cash + ₹8500 UPI.
// `amount` is always >= 0; rows with 0/blank amount are dropped before save.
export interface PaymentSplitEntry {
  id: string;
  mode: PaymentMode;
  amount: number;
  reference?: string | null; // optional UPI/txn/cheque reference
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  invoice_date: string;
  subtotal: number;
  invoice_discount: number;
  tax_amount: number;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  payment_mode: PaymentMode;   // 'split' when payment_splits.length > 1
  status: string;
  created_at: string;
  exchange_total: number;
  payment_splits?: PaymentSplitEntry[];
}

export interface InvoiceItemVaCharge {
  id: string;
  charge_name: string;
  calculation_type: CalculationType;
  value: number;
  amount: number;
}

export interface InvoiceItemDetail {
  id: string;
  product_id: string | null;
  product_name: string;
  product_code: string;
  metal_name: string;
  purity_name: string;
  quantity: number;
  gross_weight: number;
  stone_weight: number;
  net_weight: number;
  metal_rate: number;
  metal_value: number;
  making_charge_type: CalculationType;
  making_charge_value: number;
  making_charge_amount: number;
  value_added_total: number;
  discount: number;
  tax_amount: number;
  total: number;
  value_added_charges: InvoiceItemVaCharge[];
  remark?: string | null;          // NEW
}

export interface InvoiceCharge {
  id: string;
  charge_name: string;
  amount: number;
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string;
  customer_mobile: string | null;
  customer_address: string | null;
  customer_gstin: string | null;
  subtotal: number;
  invoice_discount: number;
  tax_amount: number;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  payment_mode: PaymentMode;   // 'split' when payment_splits.length > 1
  status: string;
  items: InvoiceItemDetail[];
  charges: InvoiceCharge[];
  created_at: string;
  exchange_total: number;
  exchange_items: ExchangeItemDetail[];
  payment_splits?: PaymentSplitEntry[]; // NEW — per-mode breakdown, if split
  remark: string | null; // NEW — internal reference note, not shown on the printed slip
}


export interface ExchangeItem {
  id: string;
  description: string;
  gross_weight: number;
  stone_weight: number;
  purity_id: string | null;
  purity_percent: number;     // nominal/claimed purity, e.g. 91.6 for 22K
  old_percent: number;        // NEW — tested purity from your touchstone/acid test
  deduction_percent: number;  // derived: purity_percent − old_percent
  rate_per_gram: number;
  net_weight: number;         // (gross_weight − stone_weight) × old_percent/100
  amount: number;
}

export interface ExchangeItemDetail extends ExchangeItem {
  invoice_id: string;
  created_at: string;
}