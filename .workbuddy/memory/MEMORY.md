# HAILU SC-EMS 项目长期记忆

## 项目基本信息
- **项目名称**：HAILU SC-EMS（海露供应链企业信息管理系统）
- **前端路径**：`e:/Kingsley/workbuddy/数据管理系统/Hailu-SC-EMS/frontend/`
- **技术栈**：React 19.2 + TypeScript 5.9 + Vite 7.3 + Tailwind CSS v4 + Supabase
- **后端**：Supabase 云端，URL: `https://mdukduvdzwxfheyqvkfy.supabase.co`
- **开发命令**：需 `cd frontend` 后执行 `npm run dev`

## 模块状态
| Tab ID | 组件 | 状态 |
|--------|------|------|
| dash | GroupDashboard.tsx | ✅ 已完成 |
| org | OrgManager.tsx | ✅ 已完成 |
| dept | DepartmentManager.tsx | ✅ 已完成 |
| client | ClientManager.tsx | ✅ 已完成 |
| invoices | InvoiceManager.tsx | ✅ 已完成 |
| financial/invoices | TaxInvoiceManager.tsx | ✅ 已完成 |
| financial/contracts | ContractManager.tsx | ✅ 已完成（需建表） |
| financial/expenses | ExpenseManager.tsx | ✅ 已完成（需建表） |
| users | UserManager.tsx | ✅ 已完成（admin only） |
| chat | ChatOverlay.tsx | ✅ 已完成（B2B贸易聊天中心） |
| products | ProductManager.tsx | ✅ 已完成（产品SKU资产管理） |
| settings | SettingsManager.tsx | ✅ 已完成（含 AssetManager、LogManager） |

## GitHub 仓库信息（2026-05-06 同步）
- **仓库地址**：https://github.com/chiukafai/Hailu-SC-EMS
- **账号**：chiukafai（593150075@qq.com）
- **本地路径**：`e:\Kingsley\workbuddy\数据管理系统\Hailu-SC-EMS`
- **同步命令**：`git pull origin main` 拉取最新，`git add . && git commit -m "msg" && git push` 推送
- **新增模块（Mac 同步引入）**：ChatOverlay、ProductManager、SettingsManager、useDashboardStats、baseRepository、chatService、dashboardService、dictionaryService、auditLogger
- **Vite 配置**：已添加 `server.allowedHosts: ['.trycloudflare.com']`（支持 Cloudflare Tunnel 展示）

## 代码约定
- 无路由库，Tab 切换由 App.tsx 的 useState 管理
- 无 Redux/Zustand，全部用 useState + useEffect
- 无 UI 组件库，全部 Tailwind CSS v4 手写
- 类型定义统一在 `src/types/index.ts` 导出
- 自定义 hook 放 `src/hooks/`
- services/ 目录存放业务逻辑层（baseRepository、chatService、dashboardService 等）

## 重要注意事项
- Supabase anon key 当前仍硬编码在 `src/api/supabase.ts`（后续可迁移 .env.local）
- 执行新功能前需在 Supabase Dashboard 运行 `supabase_migration.sql`（contracts + expenses 表）
- `test_schema.cjs` 等辅助脚本依赖 dotenv + .env.local（主应用不受影响）
- 构建警告：bundle chunk > 500KB，后续可考虑 vite 代码分割

## OrgManager 界面优化（2025-04-20）
- ~~左侧检索面板~~ 顶部操作栏「批量入库」右侧新增「📤 导出」按钮（蓝色），**hover 展开下拉**：
  - 「📄 导出当前页」→ 导出当页可见的公司（显示行数）
  - 「📋 导出全部」→ 导出全部公司（显示总行数）
  - 文件名格式：`海露集团档案_当前页_2026-04-20.xlsx` / `海露集团档案_全量_2026-04-20.xlsx`
- 企业简称字号从 `text-[10px]` 增大至 `text-[12px]`（增大2级），背景从 `bg-slate-900/10` 改为 `bg-blue-100`，文字颜色从 `text-slate-900` 改为 `text-blue-700`
- 下方四列（Credit ID / Legal Rep / Reg Date / Current City）字号从 `text-[12px]` 增大至 `text-[13.5px]`（增大1.5级）

## InvoiceManager 界面优化（2025-04-20）
- 表格新增复选框列，支持逐行选择，被选中行高亮浅蓝色背景
- 批量清除改为分两步：先点「☑️ 批量选中当前页」选中当前页全部，再点「🗑️ 删除已选」确认删除
- 如需清空选择，点「🚫 清空已选」取消所有勾选
- 新增「📤 导出」按钮（蓝色），hover 下拉：「导出当前页」/「导出已选」
- 导出字段包含 21 项：项目名称、部门、交易主体、主体类型、客户名称、商品、日期、地点、金额、数量、单价、发票状态、开票完成日期、流水状态、流水完成日期、已核销金额、核销率、部门ID、备注、创建时间

## ClientManager 界面优化（2025-04-20）
- 顶部操作栏「批量导入」右侧新增「📤 导出」按钮（蓝色），hover 展开下拉：导出当前页 / 导出全部，文件名格式：`海露合作客户档案_当前页/全量_日期.xlsx`
- 客户简称字号增大至 `text-[12px]`，背景改为浅绿色 `bg-emerald-100`，文字改为 `text-emerald-700`（与集团公司的蓝色形成区分）
- 四列字段（Tax ID / Legal Rep / Added Date / Status）字号从 `text-[12px]` 增大至 `text-[13.5px]`，与集团架构保持一致
