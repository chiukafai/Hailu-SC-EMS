export type ExpenseType = '贸易费用' | '财税费用' | '资金过夜' | '资金成本' | '贸易利润';
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
