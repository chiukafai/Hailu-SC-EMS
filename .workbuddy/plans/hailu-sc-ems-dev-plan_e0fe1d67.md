---
name: hailu-sc-ems-dev-plan
overview: 全面梳理 Hailu-SC-EMS（React 19 + TypeScript + Vite 7 + Supabase）项目结构与 macOS→Windows 跨平台差异，修复已知问题，并制定后续功能开发路线图
todos:
  - id: fix-env-and-supabase
    content: "[skill:Code] 创建 .env.local 并迁移 Supabase Key 到环境变量，修改 supabase.ts 读取 VITE_ 前缀变量"
    status: completed
  - id: fix-temp-path
    content: "[skill:Code] 修复 test_schema.cjs 的 /tmp/ 路径改为相对路径 ./schema_output.json"
    status: completed
    dependencies:
      - fix-env-and-supabase
  - id: fix-index-title
    content: "[skill:Code] 更新 index.html title 为 \"HAILU SC-EMS\""
    status: completed
    dependencies:
      - fix-env-and-supabase
  - id: cleanup-app-css
    content: "[skill:Code] 清理 App.css 中残留的 Vite 模板样式"
    status: completed
    dependencies:
      - fix-env-and-supabase
  - id: create-types
    content: "[skill:Code] 创建 src/types/ 目录，定义 Organization/Client/Invoice/Contract/Expense/User 接口"
    status: completed
    dependencies:
      - fix-env-and-supabase
  - id: create-contracts-table
    content: "[skill:supabase-postgres-best-practices] 在 Supabase 创建 contracts 表（含 RLS 策略），并实现 ContractManager.tsx 组件"
    status: completed
    dependencies:
      - create-types
  - id: create-expenses-table
    content: "[skill:supabase-postgres-best-practices] 在 Supabase 创建 expenses 表（含 RLS 策略），并实现 ExpenseManager.tsx 组件"
    status: completed
    dependencies:
      - create-types
  - id: refactor-invoice-manager
    content: "[skill:frontend-design] 重构 InvoiceManager.tsx，抽离数据 hooks 和复用表格/表单组件"
    status: completed
    dependencies:
      - create-types
  - id: verify-build
    content: "[skill:verification-before-completion] 在 Windows 下执行 npm run build 验证所有修复正确，构建通过"
    status: completed
    dependencies:
      - fix-temp-path
      - fix-index-title
      - cleanup-app-css
---

## 产品概述

HAILU SC-EMS（海露供应链企业信息管理系统）是一个基于 React + TypeScript + Vite + Supabase BaaS 的企业级管理平台，支持集团架构管理、部门管理、合作客户档案、业务贸易数据中心、财务数据（含发票明细）等核心功能模块。前端项目位于 `frontend/` 目录。

## 核心功能

- **集团仪表盘**：ECharts 中国地图可视化 + 销售统计（已完成）
- **集团架构管理**：组织机构 CRUD + Excel 导入导出（已完成）
- **部门管理**：部门及成员管理（已完成）
- **合作客户档案**：客户主档管理 + 分部门权限（已完成）
- **业务贸易数据中心**：贸易记录管理 + 批量导入配置（已完成）
- **财务数据**：发票明细（已完成）、合同管理（占位符）、贸易费用（占位符）
- **人权系统**：用户权限 RBAC（admin 专属）

## macOS → Windows 跨平台问题

- **P1（高）**：`test_schema.cjs` 中 `/tmp/schema_output.json` 为 Unix 路径，Windows 不存在，需改为相对路径
- **P2（高/安全）**：`src/api/supabase.ts` 中 Supabase URL 和 Anon Key 硬编码在源码，需迁移至 `.env.local`
- **P3（中）**：`index.html` 的 `<title>frontend</title>` 未改为项目名称
- **P4（低）**：`App.css` 残留 Vite 初始模板样式，可清理

## 继续开发需求

1. 完善财务模块的「合同管理」Tab（当前为占位符）
2. 完善财务模块的「贸易费用」Tab（当前为占位符）
3. 改善代码质量：补充类型定义、拆分巨大单体文件（InvoiceManager 67KB）

## 技术栈选择

- **前端框架**：React 19.2 + TypeScript 5.9（保持不变）
- **构建工具**：Vite 7.3 + Tailwind CSS v4（保持不变）
- **后端**：Supabase（云 BaaS，URL + Key 需迁移至环境变量）
- **图表**：ECharts 6 + echarts-for-react（保持不变）
- **Excel**：xlsx 库（保持不变）
- **图标**：lucide-react（保持不变）

## 实现方案

### 第一阶段：Windows 兼容性问题修复

1. **创建 `.env.local` 文件**，将 Supabase 凭据从 `src/api/supabase.ts` 迁移至环境变量

- 创建 `frontend/.env.local` 包含 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
- 修改 `src/api/supabase.ts` 读取 `import.meta.env.VITE_*`
- 确保 `.env.local` 加入 `.gitignore`（避免泄露密钥）

2. **修复 `test_schema.cjs`**：将 `/tmp/schema_output.json` 改为 `./schema_output.json`
3. **更新 `index.html` title**：改为 "HAILU SC-EMS"
4. **清理 `App.css`**：移除 Vite 模板残留样式

### 第二阶段：财务模块功能开发

#### 2.1 合同管理模块（Contracts）

- 在 Supabase 创建 `contracts` 数据表
- 实现合同列表展示（合同编号、甲方、乙方、金额、签订日期、状态等）
- 支持新增、编辑、删除、搜索、Excel 导入导出
- 与 organizations 表关联（甲方/乙方均关联到组织架构）
- 合同状态：草稿、待签署、已签署、已履行、已终止

#### 2.2 贸易费用模块（Expenses）

- 在 Supabase 创建 `expenses` 数据表
- 实现费用列表展示（费用类型、关联项目、关联发票、金额、发生日期等）
- 支持新增、编辑、删除、搜索、Excel 导入导出
- 费用类型：物流费、代理费、关税、检验费、其他
- 与 invoices 表关联

### 第三阶段：代码质量改善

- 创建 `src/types/` 目录，定义核心数据接口（Organization, Client, Invoice, Contract, Expense, User）
- 重构 `InvoiceManager.tsx`（67KB）：抽取数据 hooks、复用表格/表单组件
- 将 `GroupDashboard.tsx` 中的数据处理逻辑抽取为自定义 hooks
- 改善 App.tsx 中 `currentUser` 的类型定义

## 架构设计

- 架构模式：轻量化单页应用，App.tsx 作为路由容器，useState 管理 Tab 切换
- 组件结构：Main App → Feature Pages → Reusable UI Components
- 数据层：Supabase JS SDK 直连，无中间层封装
- 数据流：用户操作 → React state 更新 → Supabase CRUD → 组件重新渲染

### 目录结构变更

```
frontend/src/
├── types/                    # [NEW] 类型定义目录
│   ├── index.ts             # 统一导出
│   ├── organization.ts      # Organization 接口
│   ├── client.ts            # Client 接口
│   ├── invoice.ts           # Invoice 接口
│   ├── contract.ts         # Contract 接口
│   ├── expense.ts           # Expense 接口
│   └── user.ts              # User/Permission 接口
├── hooks/                   # [NEW] 自定义 hooks 目录
│   ├── useOrganizations.ts  # 组织架构 CRUD hook
│   ├── useInvoices.ts       # 贸易数据 hook
│   └── useContracts.ts      # 合同管理 hook
├── api/supabase.ts          # [MODIFY] 改为读取环境变量
├── features/
│   ├── financial/
│   │   ├── FinancialManager.tsx   # [MODIFY] 子 Tab 路由逻辑
│   │   ├── TaxInvoiceManager.tsx   # [EXISTING] 发票管理
│   │   ├── ContractManager.tsx     # [NEW] 合同管理组件
│   │   └── ExpenseManager.tsx       # [NEW] 费用管理组件
│   └── dashboard/
│       └── GroupDashboard.tsx       # [MODIFY] 抽取 hooks
└── App.tsx                         # [MODIFY] 改善类型
```

## 实现注意事项

- **环境变量**：`VITE_` 前缀是 Vite 的强制要求，仅 `VITE_` 开头的变量会在客户端代码中可见
- **.env.local vs .env**：开发环境用 `.env.local`（不提交到 git），确保密钥安全
- **Supabase RLS**：新增的 contracts 和 expenses 表需配置 Row Level Security 策略
- **类型安全**：优先使用具体类型替代 `any`，使用 TypeScript `interface` 定义数据结构
- **向后兼容**：现有 invoices/organizations 表结构不变，新表独立创建

## Agent Extensions

### Skill

- **brainstorming**
- Purpose: 在开始任何创意工作前使用，帮助理解用户需求、探索方案
- Expected outcome: 通过一问一答澄清需求，确保设计方向正确

### Skill

- **frontend-design**
- Purpose: 创建高质量生产级前端界面
- Expected outcome: 生成专业、美观、符合项目风格的 UI 代码

### Skill

- **using-git-worktrees**
- Purpose: 在隔离的工作区开始功能开发
- Expected outcome: 创建独立的 git worktree，避免污染主分支

### Skill

- **writing-plans**
- Purpose: 为多步骤任务编写详细的实现计划
- Expected outcome: 生成可执行的结构化计划文档

### Skill

- **Code**
- Purpose: 编码工作流，包含规划、实现、验证和测试
- Expected outcome: 规范的代码开发流程

### Skill

- **verification-before-completion**
- Purpose: 在声称工作完成前运行验证命令
- Expected outcome: 确保所有修复和功能经过实际验证

### Skill

- **supabase-postgres-best-practices**
- Purpose: Supabase Postgres 性能优化和最佳实践
- Expected outcome: 正确设计 contracts/expenses 表的 schema 和 RLS 策略