import type { CalculationType } from './settings';

export type ProductStatus = 'active' | 'inactive' | 'sold' | 'discontinued';
export type PaymentMode = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque';

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
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
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
  payment_mode: PaymentMode;   // NEW
  status: string;
  created_at: string;
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
  payment_mode: PaymentMode;   // NEW
  status: string;
  items: InvoiceItemDetail[];
  charges: InvoiceCharge[];
  created_at: string;
}