import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../api/supabase';
import type { Expense, ExpenseType, ExpenseStatus } from '../../types';
import * as XLSX from 'xlsx';

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  '待审核': 'bg-amber-100 text-amber-700',
  '已审核': 'bg-blue-100 text-blue-700',
  '已报销': 'bg-emerald-100 text-emerald-700',
  '已驳回': 'bg-rose-100 text-rose-600',
};

const EXPENSE_TYPES: ExpenseType[] = ['物流费', '代理费', '关税', '检验费', '仓储费', '保险费', '其他'];
const EXPENSE_STATUSES: ExpenseStatus[] = ['待审核', '已审核', '已报销', '已驳回'];
const CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY'];

const initialForm = {
  expense_type: '' as ExpenseType | '',
  project_name: '',
  amount: '',
  currency: 'CNY',
  exchange_rate: '1',
  cny_amount: '',
  occurred_at: '',
  payee: '',
  status: '待审核' as ExpenseStatus,
  remarks: '',
};

export default function ExpenseManager({
  permissionLevel = 'edit',
  currentUser,
}: {
  permissionLevel?: string;
  currentUser?: { username: string; role: string };
}) {
  const canEdit = permissionLevel === 'edit';
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalCount, setTotalCount] = useState(0);       // 【新增】服务端返回的总数
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchFilters, setSearchFilters] = useState({
    expense_type: '',
    project_name: '',
    status: '',
    date_start: '',
    date_end: '',
  });

  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter change + auto-refetch
  useEffect(() => { setCurrentPage(1); fetchExpenses(); }, [searchFilters]);
  useEffect(() => { fetchExpenses(); }, [currentPage, pageSize]);

  // 【优化】使用服务端分页 + 服务端过滤，替代原来 select('*') 全量拉取
  const fetchExpenses = async () => {
    setLoading(true);
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('expenses')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(from, to);

    // 搜索条件转为服务端过滤
    const { expense_type, project_name, status, date_start, date_end } = searchFilters;
    if (expense_type) query = query.eq('expense_type', expense_type);
    if (status) query = query.eq('status', status);
    if (project_name) query = query.ilike('project_name', `%${project_name}%`);
    if (date_start) query = query.gte('occurred_at', date_start);
    if (date_end) query = query.lte('occurred_at', date_end);

    const { data, count, error } = await query;
    if (error) {
      console.error('Fetch expenses error:', error);
      setExpenses([]);
      setTotalCount(0);
    } else {
      setExpenses((data ?? []) as Expense[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => { fetchExpenses(); }, []);

  // Auto-calc CNY amount when amount/currency/exchange_rate changes
  const handleAmountChange = (field: 'amount' | 'exchange_rate' | 'currency', value: string) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      const amt = parseFloat(updated.amount) || 0;
      const rate = parseFloat(updated.exchange_rate) || 1;
      updated.cny_amount = updated.currency === 'CNY' ? updated.amount : String((amt * rate).toFixed(2));
      return updated;
    });
  };

  useEffect(() => { fetchExpenses(); }, []); // 初始加载

  // 【优化】服务端已处理全部过滤+分页，直接透传
  const displayExpenses = expenses;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const totalCNY = displayExpenses.reduce((sum, e) => sum + (e.cny_amount ?? e.amount ?? 0), 0);

  // Group by type for summary（基于当前页数据）
  const typeSummary = useMemo(() => {
    const map: Record<string, number> = {};
    displayExpenses.forEach(e => {
      map[e.expense_type] = (map[e.expense_type] || 0) + (e.cny_amount ?? e.amount ?? 0);
    });
    return map;
  }, [displayExpenses]);

  const openNew = () => {
    setEditingId(null);
    setFormData(initialForm);
    setIsModalOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditingId(e.id);
    setFormData({
      expense_type:  e.expense_type,
      project_name:  e.project_name || '',
      amount:        e.amount != null ? String(e.amount) : '',
      currency:      e.currency || 'CNY',
      exchange_rate: e.exchange_rate != null ? String(e.exchange_rate) : '1',
      cny_amount:    e.cny_amount != null ? String(e.cny_amount) : '',
      occurred_at:   e.occurred_at || '',
      payee:         e.payee || '',
      status:        e.status || '待审核',
      remarks:       e.remarks || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!formData.expense_type || !formData.amount) return;
    setSaving(true);
    const payload = {
      expense_type:  formData.expense_type as ExpenseType,
      project_name:  formData.project_name.trim() || null,
      amount:        parseFloat(formData.amount),
      currency:      formData.currency,
      exchange_rate: parseFloat(formData.exchange_rate) || 1,
      cny_amount:    formData.cny_amount !== '' ? parseFloat(formData.cny_amount) : parseFloat(formData.amount),
      occurred_at:   formData.occurred_at || null,
      payee:         formData.payee.trim() || null,
      status:        formData.status,
      remarks:       formData.remarks.trim() || null,
      created_by:    currentUser?.username || null,
    };
    if (editingId) {
      await supabase.from('expenses').update(payload).eq('id', editingId);
    } else {
      await supabase.from('expenses').insert(payload);
    }
    setSaving(false);
    setIsModalOpen(false);
    fetchExpenses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该费用记录？')) return;
    await supabase.from('expenses').delete().eq('id', id);
    fetchExpenses();
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录？`)) return;
    await supabase.from('expenses').delete().in('id', [...selectedIds]);
    setSelectedIds(new Set());
    fetchExpenses();
  };

  const handleExport = async () => {
    // 导出当前筛选条件下的全部数据
    let exportList: Expense[];
    if (totalCount <= pageSize) {
      exportList = displayExpenses;
    } else {
      let query = supabase.from('expenses').select('*').order('occurred_at', { ascending: false });
      const { expense_type, project_name, status, date_start, date_end } = searchFilters;
      if (expense_type) query = query.eq('expense_type', expense_type);
      if (status) query = query.eq('status', status);
      if (project_name) query = query.ilike('project_name', `%${project_name}%`);
      if (date_start) query = query.gte('occurred_at', date_start);
      if (date_end) query = query.lte('occurred_at', date_end);
      const { data } = await query;
      exportList = (data ?? []) as Expense[];
    }
    const rows = exportList.map(e => ({
      '费用类型':   e.expense_type,
      '所属项目':   e.project_name || '',
      '金额':       e.amount,
      '币种':       e.currency || 'CNY',
      '汇率':       e.exchange_rate || 1,
      '人民币金额': e.cny_amount ?? e.amount,
      '发生日期':   e.occurred_at || '',
      '收款方':     e.payee || '',
      '状态':       e.status || '',
      '备注':       e.remarks || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '贸易费用');
    XLSX.writeFile(wb, `贸易费用_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === displayExpenses.length && displayExpenses.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayExpenses.map(e => e.id)));
    }
  };

  const fmtAmount = (v?: number | null, currency = 'CNY') => {
    if (v == null) return '—';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'HKD' ? 'HK$' : '¥';
    return `${symbol} ${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">贸易费用</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            共 <span className="font-bold text-slate-600">{totalCount}</span> 条 ·
            折合人民币合计 <span className="font-bold text-blue-600">{fmtAmount(totalCNY)}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && canEdit && (
            <button onClick={handleBatchDelete}
              className="px-4 py-2 text-xs font-bold bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 border border-rose-200 transition-colors">
              删除选中 ({selectedIds.size})
            </button>
          )}
          <button onClick={handleExport}
            className="px-4 py-2 text-xs font-bold bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors">
            导出 Excel
          </button>
          {canEdit && (
            <button onClick={openNew}
              className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">
              + 新增费用
            </button>
          )}
        </div>
      </div>

      {/* ── Type Summary Cards ── */}
      {Object.keys(typeSummary).length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {EXPENSE_TYPES.filter(t => typeSummary[t]).map(t => (
            <div key={t} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 mb-1">{t}</div>
              <div className="text-xs font-black text-slate-700">¥{(typeSummary[t] / 10000).toFixed(1)}万</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <select className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.expense_type}
          onChange={e => setSearchFilters(p => ({ ...p, expense_type: e.target.value }))}>
          <option value="">全部费用类型</option>
          {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
          placeholder="所属项目" value={searchFilters.project_name}
          onChange={e => setSearchFilters(p => ({ ...p, project_name: e.target.value }))} />
        <select className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.status}
          onChange={e => setSearchFilters(p => ({ ...p, status: e.target.value }))}>
          <option value="">全部状态</option>
          {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date"
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.date_start}
          onChange={e => setSearchFilters(p => ({ ...p, date_start: e.target.value }))} />
        <input type="date"
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.date_end}
          onChange={e => setSearchFilters(p => ({ ...p, date_end: e.target.value }))} />
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {canEdit && (
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox"
                      checked={selectedIds.size === displayExpenses.length && displayExpenses.length > 0}
                      onChange={toggleSelectAll} className="rounded" />
                  </th>
                )}
                {['费用类型', '所属项目', '金额', '币种', '人民币金额', '发生日期', '收款方', '状态', '备注', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-black text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-12 text-slate-400 font-bold">加载中...</td></tr>
              ) : displayExpenses.length === 0 ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-16 text-slate-300">
                  <div className="text-4xl mb-2">💸</div>
                  <div className="font-bold">暂无费用记录</div>
                </td></tr>
              ) : displayExpenses.map((e, i) => (
                <tr key={e.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} className="rounded" />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-[10px] whitespace-nowrap">{e.expense_type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[120px] truncate" title={e.project_name}>{e.project_name || '—'}</td>
                  <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap text-right">{fmtAmount(e.amount, e.currency)}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{e.currency || 'CNY'}</td>
                  <td className="px-4 py-3 font-bold text-blue-700 whitespace-nowrap text-right">{fmtAmount(e.cny_amount ?? e.amount)}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{e.occurred_at || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{e.payee || '—'}</td>
                  <td className="px-4 py-3">
                    {e.status && (
                      <span className={`px-2 py-1 rounded-lg font-bold text-[10px] whitespace-nowrap ${STATUS_COLORS[e.status as ExpenseStatus]}`}>
                        {e.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[120px] truncate" title={e.remarks}>{e.remarks || '—'}</td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(e)}
                          className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors">编辑</button>
                        <button onClick={() => handleDelete(e.id)}
                          className="px-2 py-1 rounded-lg bg-rose-50 text-rose-500 font-bold hover:bg-rose-100 transition-colors">删除</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>每页</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none">
              {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>条 · 共 {totalCount} 条</span>
          </div>
          <div className="flex gap-1">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">
              上一页
            </button>
            <span className="px-3 py-1 text-xs font-bold text-slate-600">{currentPage} / {totalPages}</span>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base">{editingId ? '编辑费用' : '新增费用'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-8 py-6">
              <div className="grid grid-cols-2 gap-4">
                {/* 费用类型 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">费用类型 *</label>
                  <select required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.expense_type} onChange={e => setFormData(p => ({ ...p, expense_type: e.target.value as ExpenseType | '' }))}>
                    <option value="">请选择</option>
                    {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* 状态 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">状态</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value as ExpenseStatus }))}>
                    {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* 所属项目 */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">所属项目</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.project_name} onChange={e => setFormData(p => ({ ...p, project_name: e.target.value }))} />
                </div>
                {/* 金额 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">金额 *</label>
                  <input type="number" required step="0.01" min="0"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.amount} onChange={e => handleAmountChange('amount', e.target.value)} />
                </div>
                {/* 币种 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">币种</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.currency} onChange={e => handleAmountChange('currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {/* 汇率 & 人民币金额 */}
                {formData.currency !== 'CNY' && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">汇率</label>
                      <input type="number" step="0.000001" min="0"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                        value={formData.exchange_rate} onChange={e => handleAmountChange('exchange_rate', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">人民币金额（自动计算）</label>
                      <input type="number" step="0.01"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none text-blue-700 font-bold"
                        value={formData.cny_amount} onChange={e => setFormData(p => ({ ...p, cny_amount: e.target.value }))} />
                    </div>
                  </>
                )}
                {/* 发生日期 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">发生日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.occurred_at} onChange={e => setFormData(p => ({ ...p, occurred_at: e.target.value }))} />
                </div>
                {/* 收款方 */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">收款方</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.payee} onChange={e => setFormData(p => ({ ...p, payee: e.target.value }))} />
                </div>
                {/* 备注 */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">备注</label>
                  <textarea rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none resize-none"
                    value={formData.remarks} onChange={e => setFormData(p => ({ ...p, remarks: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                  取消
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 transition-colors disabled:opacity-50">
                  {saving ? '保存中...' : (editingId ? '更新记录' : '创建记录')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
