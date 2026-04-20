export interface Client {
  id: string;
  department_name?: string;
  full_name: string;
  short_name?: string;
  tax_id?: string;
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
  risk_level?: 'low' | 'medium' | 'high' | '低风险' | '中风险' | '高风险';
  added_at?: string;
  created_at?: string;
  updated_at?: string;
}
