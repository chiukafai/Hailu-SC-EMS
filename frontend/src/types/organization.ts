export interface Organization {
  id: string;
  name: string;
  short_name?: string;
  tax_id?: string;
  finance_leader?: string;
  founded_at?: string;
  legal_person?: string;
  legal_phone?: string;
  shareholders?: string;
  registered_capital?: string;
  province?: string;
  city?: string;
  address?: string;
  bank_name?: string;
  bank_account?: string;
  invoice_limit?: number;
  credit_rating?: string;
  taxpayer_type?: string;
  parent_path?: string;
  created_at?: string;
  updated_at?: string;
}
