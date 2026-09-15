export type CalculationType = 'fixed' | 'per_gram' | 'percentage';

export interface CompanySettings {
  id: number;
  company_name: string;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  website: string | null;
}

export interface Metal {
  id: string;
  name: string;
  code: string;
  type: 'gold' | 'silver' | 'platinum' | 'other';
  is_active: boolean;
}

export interface Purity {
  id: string;
  metal_id: string;
  name: string;
  purity_percentage: number | null;
  is_active: boolean;
}

export interface MetalRate {
  id: string;
  metal_id: string;
  purity_id: string;
  rate_per_gram: number;
  effective_date: string;
  effective_time: string;
}

export interface CurrentMetalRate {
  metal_id: string;
  purity_id: string;
  rate_per_gram: number;
  effective_date: string;
  effective_time: string;
  metal_rate_id: string;
}

export interface Category {
  id: string;
  name: string;
  is_active: boolean;
}

export interface MakingChargeRule {
  id: string;
  metal_id: string;
  purity_id: string | null;
  category_id: string | null;
  calculation_type: CalculationType;
  value: number;
  is_active: boolean;
}

export interface ValueAddedChargeType {
  id: string;
  name: string;
  calculation_type: CalculationType;
  default_value: number;
  is_active: boolean;
}

export interface TaxSetting {
  id: string;
  tax_name: string;
  tax_percentage: number;
  cgst: number;
  sgst: number;
  igst: number;
  is_active: boolean;
}

export interface InvoiceSettings {
  id: number;
  invoice_prefix: string;
  invoice_number_format: string;
  starting_number: number;
  invoice_footer: string | null;
  terms_and_conditions: string | null;
  show_logo: boolean;
  show_huid: boolean;
  show_weight: boolean;
  show_making_charges: boolean;
  show_value_added_charges: boolean;
}

// Append this block to the bottom of src/types/settings.ts

export type StaffRole = 'admin' | 'manager' | 'staff';

export interface Staff {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
}

export interface StaffPermission {
  id: string;
  staff_id: string;
  page_key: string;
  can_access: boolean;
}

// Every controllable page in the app. Add a new entry here whenever you add a
// new top-level screen or Settings sub-page that should be gated.
export const PAGE_REGISTRY = [
  { key: 'dashboard', label: 'Dashboard', group: 'Main' },
  { key: 'products', label: 'Products', group: 'Main' },
  { key: 'invoices', label: 'Invoices', group: 'Main' },
  { key: 'customers', label: 'Customers', group: 'Main' },
  { key: 'settings', label: 'Settings (menu)', group: 'Main' },
  { key: 'settings.company', label: 'Company', group: 'Settings' },
  { key: 'settings.company_logo', label: 'Company Logo', group: 'Settings' }, // NEW
  { key: 'settings.metals', label: 'Metals', group: 'Settings' },
  { key: 'settings.purity', label: 'Purity', group: 'Settings' },
  { key: 'settings.categories', label: 'Categories', group: 'Settings' },
  { key: 'settings.gold_rates', label: 'Gold Rates', group: 'Settings' },
  { key: 'settings.making_charges', label: 'Making Charges', group: 'Settings' },
  { key: 'settings.value_added_charges', label: 'Value Added Charges', group: 'Settings' },
  { key: 'settings.tax', label: 'Tax', group: 'Settings' },
  { key: 'settings.invoice_settings', label: 'Invoice Settings', group: 'Settings' },
  { key: 'settings.staff', label: 'Staff', group: 'Settings' },
] as const;

export type PageKey = (typeof PAGE_REGISTRY)[number]['key'];