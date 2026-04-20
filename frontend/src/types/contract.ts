export type ContractStatus = '草稿' | '待签署' | '已签署' | '已履行' | '已终止';
export type ContractType = '采购合同' | '销售合同' | '服务合同' | '框架协议' | '其他';

export interface Contract {
  id: string;
  contract_no: string;
  contract_name: string;
  contract_type?: ContractType;
  party_a_id?: string;       // 甲方 org_id
  party_a_name?: string;
  party_b_id?: string;       // 乙方 org_id 或客户 id
  party_b_name?: string;
  amount?: number;
  signed_at?: string;
  effective_at?: string;
  expired_at?: string;
  status: ContractStatus;
  department_id?: string;
  remarks?: string;
  file_url?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}
