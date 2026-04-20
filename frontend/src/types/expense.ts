export type ExpenseType = '物流费' | '代理费' | '关税' | '检验费' | '仓储费' | '保险费' | '其他';
export type ExpenseStatus = '待审核' | '已审核' | '已报销' | '已驳回';

export interface Expense {
  id: string;
  expense_type: ExpenseType;
  project_name?: string;
  related_invoice_id?: string;
  related_contract_id?: string;
  amount: number;
  currency?: string;
  exchange_rate?: number;
  cny_amount?: number;
  occurred_at?: string;
  department_id?: string;
  payee?: string;
  status?: ExpenseStatus;
  remarks?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}
