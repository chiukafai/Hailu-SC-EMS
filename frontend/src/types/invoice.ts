export type InvoiceStatus = '已开票' | '未开票' | '部分开票';
export type TransactionStatus = '已走流水' | '未走流水';

export interface Invoice {
  id: string;
  org_id?: string;
  department_id?: string;
  project_name?: string;
  product_info?: string;
  quantity?: number;
  unit_price?: number;
  amount: number;
  client_name?: string;
  invoice_status?: InvoiceStatus;
  transaction_status?: TransactionStatus;
  trade_date?: string;
  trade_location?: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  // joined fields
  organizations?: { name: string };
}

export type TaxInvoiceStatus = '已认证' | '未认证' | '作废';

export interface TaxInvoice {
  id: string;
  invoice_code?: string;
  invoice_number?: string;
  invoice_date?: string;
  seller_name?: string;
  seller_tax_id?: string;
  buyer_name?: string;
  buyer_tax_id?: string;
  goods_or_services?: string;
  amount_excl_tax?: number;
  tax_rate?: number;
  tax_amount?: number;
  total_amount?: number;
  status?: TaxInvoiceStatus;
  remarks?: string;
  department_id?: string;
  created_at?: string;
  updated_at?: string;
}
