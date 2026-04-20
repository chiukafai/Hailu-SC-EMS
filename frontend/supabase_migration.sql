-- ============================================================
-- HAILU SC-EMS 新增表结构
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- ============================================================
-- 1. 合同管理表 (contracts)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no     TEXT NOT NULL UNIQUE,
  contract_name   TEXT NOT NULL,
  contract_type   TEXT CHECK (contract_type IN ('采购合同','销售合同','服务合同','框架协议','其他')),
  party_a_id      UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  party_a_name    TEXT,
  party_b_id      UUID,                  -- 可以是 organizations.id 或 clients.id
  party_b_name    TEXT,
  amount          NUMERIC(18, 2),
  signed_at       DATE,
  effective_at    DATE,
  expired_at      DATE,
  status          TEXT NOT NULL DEFAULT '草稿'
                  CHECK (status IN ('草稿','待签署','已签署','已履行','已终止')),
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  remarks         TEXT,
  file_url        TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_contracts_status      ON public.contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_party_a     ON public.contracts(party_a_id);
CREATE INDEX IF NOT EXISTS idx_contracts_department  ON public.contracts(department_id);
CREATE INDEX IF NOT EXISTS idx_contracts_signed_at   ON public.contracts(signed_at);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- 允许所有已认证用户读取（前端用 anon key，放开 SELECT）
CREATE POLICY "contracts_select" ON public.contracts
  FOR SELECT USING (true);

CREATE POLICY "contracts_insert" ON public.contracts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "contracts_update" ON public.contracts
  FOR UPDATE USING (true);

CREATE POLICY "contracts_delete" ON public.contracts
  FOR DELETE USING (true);


-- ============================================================
-- 2. 贸易费用表 (expenses)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expenses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_type         TEXT NOT NULL
                       CHECK (expense_type IN ('物流费','代理费','关税','检验费','仓储费','保险费','其他')),
  project_name         TEXT,
  related_invoice_id   UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  related_contract_id  UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  amount               NUMERIC(18, 2) NOT NULL,
  currency             TEXT DEFAULT 'CNY',
  exchange_rate        NUMERIC(10, 6) DEFAULT 1,
  cny_amount           NUMERIC(18, 2),
  occurred_at          DATE,
  department_id        UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  payee                TEXT,
  status               TEXT DEFAULT '待审核'
                       CHECK (status IN ('待审核','已审核','已报销','已驳回')),
  remarks              TEXT,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_expenses_type         ON public.expenses(expense_type);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_invoice      ON public.expenses(related_invoice_id);
CREATE INDEX IF NOT EXISTS idx_expenses_department   ON public.expenses(department_id);
CREATE INDEX IF NOT EXISTS idx_expenses_occurred_at  ON public.expenses(occurred_at);

-- 触发器
CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT USING (true);

CREATE POLICY "expenses_insert" ON public.expenses
  FOR INSERT WITH CHECK (true);

CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE USING (true);

CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE USING (true);


-- ============================================================
-- 完成提示
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'HAILU SC-EMS: contracts 和 expenses 表创建完成';
END;
$$;
