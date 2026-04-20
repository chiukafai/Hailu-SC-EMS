import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../api/supabase';
import type { Contract, ContractStatus, ContractType } from '../../types';
import * as XLSX from 'xlsx';

const STATUS_COLORS: Record<ContractStatus, string> = {
  '草稿':   'bg-slate-100 text-slate-600',
  '待签署': 'bg-amber-100 text-amber-700',
  '已签署': 'bg-blue-100 text-blue-700',
  '已履行': 'bg-emerald-100 text-emerald-700',
  '已终止': 'bg-rose-100 text-rose-600',
};

const CONTRACT_TYPES: ContractType[] = ['采购合同', '销售合同', '服务合同', '框架协议', '其他'];
const CONTRACT_STATUSES: ContractStatus[] = ['草稿', '待签署', '已签署', '已履行', '已终止'];

const initialForm = {
  contract_no: '',
  contract_name: '',
  contract_type: '' as ContractType | '',
  party_a_name: '',
  party_b_name: '',
  amount: '',
  signed_at: '',
  effective_at: '',
  expired_at: '',
  status: '草稿' as ContractStatus,
  remarks: '',
};

export default function ContractManager({
  permissionLevel = 'edit',
  currentUser,
}: {
  permissionLevel?: string;
  currentUser?: { username: string; role: string };
}) {
  const canEdit = permissionLevel === 'edit';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchFilters, setSearchFilters] = useState({
    contract_name: '',
    party_a_name: '',
    party_b_name: '',
    status: '',
    contract_type: '',
    date_start: '',
    date_end: '',
  });

  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter/data change
  useEffect(() => { setCurrentPage(1); }, [searchFilters, contracts, pageSize]);

  const fetchContracts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setContracts(data as Contract[]);
    setLoading(false);
  };

  useEffect(() => { fetchContracts(); }, []);

  const filtered = useMemo(() => {
    return contracts.filter(c => {
      const name   = searchFilters.contract_name.toLowerCase();
      const partyA = searchFilters.party_a_name.toLowerCase();
      const partyB = searchFilters.party_b_name.toLowerCase();
      if (name   && !c.contract_name?.toLowerCase().includes(name))   return false;
      if (partyA && !c.party_a_name?.toLowerCase().includes(partyA)) return false;
      if (partyB && !c.party_b_name?.toLowerCase().includes(partyB)) return false;
      if (searchFilters.status && c.status !== searchFilters.status) return false;
      if (searchFilters.contract_type && c.contract_type !== searchFilters.contract_type) return false;
      if (searchFilters.date_start && c.signed_at && c.signed_at < searchFilters.date_start) return false;
      if (searchFilters.date_end   && c.signed_at && c.signed_at > searchFilters.date_end)   return false;
      return true;
    });
  }, [contracts, searchFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalAmount = filtered.reduce((sum, c) => sum + (c.amount || 0), 0);

  const openNew = () => {
    setEditingId(null);
    setFormData(initialForm);
    setIsModalOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditingId(c.id);
    setFormData({
      contract_no:    c.contract_no,
      contract_name:  c.contract_name,
      contract_type:  c.contract_type || '',
      party_a_name:   c.party_a_name || '',
      party_b_name:   c.party_b_name || '',
      amount:         c.amount != null ? String(c.amount) : '',
      signed_at:      c.signed_at || '',
      effective_at:   c.effective_at || '',
      expired_at:     c.expired_at || '',
      status:         c.status,
      remarks:        c.remarks || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.contract_no.trim() || !formData.contract_name.trim()) return;
    setSaving(true);
    const payload = {
      contract_no:   formData.contract_no.trim(),
      contract_name: formData.contract_name.trim(),
      contract_type: formData.contract_type || null,
      party_a_name:  formData.party_a_name.trim() || null,
      party_b_name:  formData.party_b_name.trim() || null,
      amount:        formData.amount !== '' ? parseFloat(formData.amount) : null,
      signed_at:     formData.signed_at || null,
      effective_at:  formData.effective_at || null,
      expired_at:    formData.expired_at || null,
      status:        formData.status,
      remarks:       formData.remarks.trim() || null,
      created_by:    currentUser?.username || null,
    };
    if (editingId) {
      await supabase.from('contracts').update(payload).eq('id', editingId);
    } else {
      await supabase.from('contracts').insert(payload);
    }
    setSaving(false);
    setIsModalOpen(false);
    fetchContracts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该合同？此操作不可撤销。')) return;
    await supabase.from('contracts').delete().eq('id', id);
    fetchContracts();
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条合同？`)) return;
    await supabase.from('contracts').delete().in('id', [...selectedIds]);
    setSelectedIds(new Set());
    fetchContracts();
  };

  const handleExport = () => {
    const rows = filtered.map(c => ({
      '合同编号': c.contract_no,
      '合同名称': c.contract_name,
      '合同类型': c.contract_type || '',
      '甲方':     c.party_a_name || '',
      '乙方':     c.party_b_name || '',
      '合同金额': c.amount ?? '',
      '签订日期': c.signed_at || '',
      '生效日期': c.effective_at || '',
      '到期日期': c.expired_at || '',
      '状态':     c.status,
      '备注':     c.remarks || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '合同列表');
    XLSX.writeFile(wb, `合同列表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === paginated.length && paginated.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginated.map(c => c.id)));
    }
  };

  const fmtAmount = (v?: number | null) =>
    v != null ? `¥ ${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">合同管理</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            共 <span className="font-bold text-slate-600">{filtered.length}</span> 份合同 ·
            总金额 <span className="font-bold text-blue-600">{fmtAmount(totalAmount)}</span>
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
              + 新增合同
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { key: 'contract_name', placeholder: '合同名称' },
          { key: 'party_a_name',  placeholder: '甲方' },
          { key: 'party_b_name',  placeholder: '乙方' },
        ].map(f => (
          <input key={f.key}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
            placeholder={f.placeholder}
            value={searchFilters[f.key as keyof typeof searchFilters]}
            onChange={e => setSearchFilters(p => ({ ...p, [f.key]: e.target.value }))}
          />
        ))}
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.status}
          onChange={e => setSearchFilters(p => ({ ...p, status: e.target.value }))}>
          <option value="">全部状态</option>
          {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.contract_type}
          onChange={e => setSearchFilters(p => ({ ...p, contract_type: e.target.value }))}>
          <option value="">全部类型</option>
          {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                      checked={selectedIds.size === paginated.length && paginated.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded" />
                  </th>
                )}
                {['合同编号', '合同名称', '类型', '甲方', '乙方', '金额', '签订日期', '到期日期', '状态', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-black text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-12 text-slate-400 font-bold">加载中...</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-16 text-slate-300">
                  <div className="text-4xl mb-2">📄</div>
                  <div className="font-bold">暂无合同数据</div>
                </td></tr>
              ) : paginated.map((c, i) => (
                <tr key={c.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded" />
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">{c.contract_no}</td>
                  <td className="px-4 py-3 font-bold text-slate-800 max-w-[180px] truncate" title={c.contract_name}>{c.contract_name}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.contract_type || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[120px] truncate" title={c.party_a_name}>{c.party_a_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[120px] truncate" title={c.party_b_name}>{c.party_b_name || '—'}</td>
                  <td className="px-4 py-3 font-bold text-blue-700 whitespace-nowrap text-right">{fmtAmount(c.amount)}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.signed_at || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.expired_at
                      ? <span className={`${new Date(c.expired_at) < new Date() && c.status === '已签署' ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>{c.expired_at}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg font-bold text-[10px] whitespace-nowrap ${STATUS_COLORS[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)}
                          className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors">编辑</button>
                        <button onClick={() => handleDelete(c.id)}
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
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none">
              {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>条 · 共 {filtered.length} 条</span>
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
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base">{editingId ? '编辑合同' : '新增合同'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-8 py-6">
              <div className="grid grid-cols-2 gap-4">
                {/* 合同编号 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同编号 *</label>
                  <input required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.contract_no} onChange={e => setFormData(p => ({ ...p, contract_no: e.target.value }))} />
                </div>
                {/* 合同类型 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同类型</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.contract_type} onChange={e => setFormData(p => ({ ...p, contract_type: e.target.value as ContractType | '' }))}>
                    <option value="">请选择</option>
                    {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* 合同名称 */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同名称 *</label>
                  <input required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.contract_name} onChange={e => setFormData(p => ({ ...p, contract_name: e.target.value }))} />
                </div>
                {/* 甲方 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">甲方名称</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.party_a_name} onChange={e => setFormData(p => ({ ...p, party_a_name: e.target.value }))} />
                </div>
                {/* 乙方 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">乙方名称</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.party_b_name} onChange={e => setFormData(p => ({ ...p, party_b_name: e.target.value }))} />
                </div>
                {/* 金额 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同金额（元）</label>
                  <input type="number" step="0.01" min="0"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
                </div>
                {/* 状态 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同状态</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value as ContractStatus }))}>
                    {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* 签订日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">签订日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.signed_at} onChange={e => setFormData(p => ({ ...p, signed_at: e.target.value }))} />
                </div>
                {/* 生效日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">生效日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.effective_at} onChange={e => setFormData(p => ({ ...p, effective_at: e.target.value }))} />
                </div>
                {/* 到期日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">到期日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.expired_at} onChange={e => setFormData(p => ({ ...p, expired_at: e.target.value }))} />
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
                  {saving ? '保存中...' : (editingId ? '更新合同' : '创建合同')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
