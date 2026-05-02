import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../api/supabase';
import * as XLSX from 'xlsx';

export default function OrgManager({ permissionLevel = 'edit' }: { permissionLevel?: string }) {
    const canEdit = permissionLevel === 'edit';
    const [orgs, setOrgs] = useState<any[]>([]);
    const [searchFilters, setSearchFilters] = useState({ 
        name: '', 
        tax_id: '', 
        city: '', 
        legal_person: '',
        startDate: '',
        endDate: ''
    });
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const [editingId, setEditingId] = useState<string | null>(null);
    const [parentPath, setParentPath] = useState('Group');
    const [isImporting, setIsImporting] = useState(false);
    
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    
    // Reset pagination when search queries change
    useEffect(() => { setCurrentPage(1); }, [searchFilters, orgs, pageSize]);

    const initialForm = {
        name: '', short_name: '', tax_id: '', finance_leader: '',
        founded_at: '', legal_person: '', legal_phone: '',
        shareholders: '', reg_capital: '', reg_address: '',
        province: '', city: '', bank_name: '', bank_account: '',
        invoice_quota: '', credit_rating: 'A', taxpayer_type: '一般纳税人'
    };

    const [formData, setFormData] = useState(initialForm);

    const fetchOrgs = async () => {
        let allData: any[] = [];
        let start = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('organizations')
                .select('*')
                .order('path')
                .range(start, start + limit - 1);

            if (error) {
                console.error('Fetch orgs error:', error);
                break;
            }

            if (data && data.length > 0) {
                allData = [...allData, ...data];
                start += limit;
                if (data.length < limit) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        if (allData.length > 0 || start === 0) {
            setOrgs(allData);
        }
    };

    useEffect(() => { fetchOrgs(); }, []);

    const handleSubmit = async () => {
        if (!formData.name || !formData.tax_id) {
            alert("实体名称和信用代码为必填项");
            return;
        }
        if (editingId) {
            const { error } = await supabase.from('organizations').update(formData).eq('id', editingId);
            if (error) alert(error.message);
            else {
                alert('档案更新成功');
                resetForm();
                fetchOrgs();
            }
        } else {
            const safeName = formData.name.replace(/[^\p{L}\p{N}_]/gu, '_');
            const newPath = parentPath === 'Group' ? `Group.${safeName}` : `${parentPath}.${safeName}`;
            const { error } = await supabase.from('organizations').insert([{ ...formData, path: newPath, org_type: 'Subsidiary' }]);
            if (error) alert(error.message);
            else {
                alert('新节点已入库');
                resetForm();
                fetchOrgs();
            }
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`确定要彻底删除 [${name}] 吗？`)) {
            const { error } = await supabase.from('organizations').delete().eq('id', id);
            if (error) alert(error.message);
            else fetchOrgs();
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (window.confirm(`警告：确定要批量删除选中的 ${selectedIds.size} 家公司档案吗？此操作不可逆！`)) {
            const { error } = await supabase.from('organizations').delete().in('id', Array.from(selectedIds));
            if (error) alert(error.message);
            else {
                alert('批量删除成功');
                setSelectedIds(new Set());
                fetchOrgs();
            }
        }
    };

    const startEdit = (org: any) => {
        setEditingId(org.id);
        setFormData({ ...org });
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData(initialForm);
        setIsModalOpen(false);
    };

    const startAdd = () => {
        setEditingId(null);
        setFormData(initialForm);
        setIsModalOpen(true);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData: any[] = XLSX.utils.sheet_to_json(sheet);
            const fieldMapping: Record<string, string> = {
                '实体全称': 'name', '机构简称': 'short_name', '信用代码': 'tax_id',
                '财务负责人': 'finance_leader', '成立时间': 'founded_at', '法人代表': 'legal_person',
                '法人电话': 'legal_phone', '股东及持股比例': 'shareholders', '注册资本': 'reg_capital',
                '详细注册地址': 'reg_address', '省份': 'province', '城市': 'city',
                '开户银行': 'bank_name', '银行账号': 'bank_account', '发票额度': 'invoice_quota',
                '信用评级': 'credit_rating', '纳税人类型': 'taxpayer_type'
            };
            const recordsToInsert = jsonData.map(row => {
                const rawName = String(row['实体全称'] || 'Unknown');
                const safeName = rawName.replace(/[^\p{L}\p{N}_]/gu, '_');
                const newRecord: any = { org_type: 'Subsidiary', path: `Group.${safeName}` };
                Object.keys(row).forEach(key => {
                    const englishKey = fieldMapping[key];
                    if (englishKey) {
                        let val = row[key];
                        if (englishKey === 'founded_at' && typeof val === 'number') {
                            newRecord[englishKey] = new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
                        } else if (englishKey === 'reg_capital' || englishKey === 'invoice_quota') {
                            newRecord[englishKey] = parseFloat(String(val).replace(/[^0-9.-]+/g, '')) || 0;
                        } else { newRecord[englishKey] = String(val); }
                    }
                });
                return newRecord;
            }).filter(r => r.name && r.tax_id);
            if (recordsToInsert.length === 0) { alert('无合规数据'); return; }
            const { error } = await supabase.from('organizations').insert(recordsToInsert);
            if (error) alert(error.message);
            else { alert(`成功导入 ${recordsToInsert.length} 条!`); fetchOrgs(); }
        } catch (error: any) { alert(error.message); } finally { setIsImporting(false); if (e.target) e.target.value = ''; }
    };

    // Filters logic
    const filteredOrgs = useMemo(() => {
        return orgs.filter(org => {
            if (searchFilters.name && !org.name?.toLowerCase().includes(searchFilters.name.toLowerCase()) && !org.short_name?.toLowerCase().includes(searchFilters.name.toLowerCase())) return false;
            if (searchFilters.tax_id && !org.tax_id?.toLowerCase().includes(searchFilters.tax_id.toLowerCase())) return false;
            if (searchFilters.city && !org.city?.toLowerCase().includes(searchFilters.city.toLowerCase())) return false;
            if (searchFilters.legal_person && !org.legal_person?.toLowerCase().includes(searchFilters.legal_person.toLowerCase())) return false;
            
            if (searchFilters.startDate && org.founded_at && org.founded_at < searchFilters.startDate) return false;
            if (searchFilters.endDate && org.founded_at && org.founded_at > searchFilters.endDate) return false;
            
            return true;
        });
    }, [orgs, searchFilters]);
    
    const paginatedOrgs = filteredOrgs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const totalPages = Math.ceil(filteredOrgs.length / pageSize);

    const toggleSelectAll = (checked: boolean) => {
        const newSet = new Set(selectedIds);
        paginatedOrgs.forEach(o => {
            if (checked) newSet.add(o.id);
            else newSet.delete(o.id);
        });
        setSelectedIds(newSet);
    };

    const toggleSelectOne = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const isAllSelected = paginatedOrgs.length > 0 && paginatedOrgs.every(o => selectedIds.has(o.id));

    // 导出档案数据（支持导出当前页或全部）
    const handleExport = (scope: 'page' | 'all') => {
        const dataToExport = scope === 'page' ? paginatedOrgs : orgs;
        const exportData = dataToExport.map(org => ({
            '实体全称': org.name,
            '机构简称': org.short_name,
            '信用代码': org.tax_id,
            '财务负责人': org.finance_leader,
            '成立时间': org.founded_at,
            '法人代表': org.legal_person,
            '法人电话': org.legal_phone,
            '股东及持股比例': org.shareholders,
            '注册资本': org.reg_capital,
            '详细注册地址': org.reg_address,
            '省份': org.province,
            '城市': org.city,
            '开户银行': org.bank_name,
            '银行账号': org.bank_account,
            '发票额度': org.invoice_quota,
            '信用评级': org.credit_rating,
            '纳税人类型': org.taxpayer_type,
            '架构路径': org.path,
            '企业类型': org.org_type
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '集团档案');
        const label = scope === 'page' ? '当前页' : '全量';
        XLSX.writeFile(wb, `海露集团档案_${label}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen">
            
            {/* Modal Form */}
            {isModalOpen && canEdit && (
                <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 bg-slate-900/40 backdrop-blur-sm print:hidden">
                    <div className="relative w-full max-w-4xl mx-auto max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
                        <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <span className={`w-2 h-6 ${editingId ? 'bg-amber-500' : 'bg-blue-600'} rounded-full`}></span>
                                {editingId ? '编辑集团成员档案' : '新建集团节点'}
                            </h3>
                            <button onClick={resetForm} className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 font-bold w-10 h-10 rounded-full flex items-center justify-center transition-all">✕</button>
                        </div>
                        <div className="p-8 overflow-y-auto flex-1 bg-white space-y-6">
                            <section className="bg-slate-50 p-5 rounded-2xl space-y-4">
                                <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">1. 核心关系与工商代码</h3>
                                {!editingId && (
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">所属父级节点</label>
                                        <select className="w-full border-none bg-white p-3.5 rounded-xl text-sm shadow-sm font-bold" value={parentPath} onChange={e => setParentPath(e.target.value)}>
                                            <option value="Group">--- 集团总部 (ROOT) ---</option>
                                            {orgs.map(o => <option key={o.id} value={o.path}>{o.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">实体政务全称*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-black" placeholder="实体全称 (需与营业执照一致)" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">简写代码*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="简称 (如: HL-SC)" value={formData.short_name} onChange={e => setFormData({ ...formData, short_name: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">信用代码 (税号)*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-mono" placeholder="18位统一社会信用代码" value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} />
                                    </div>
                                </div>
                            </section>

                            <section className="bg-slate-50 p-5 rounded-2xl space-y-4">
                                <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">2. 工商登记及法定要素</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">成立日期</label>
                                        <input type="date" className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" value={formData.founded_at} onChange={e => setFormData({ ...formData, founded_at: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">法定代表人</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-bold" placeholder="姓名" value={formData.legal_person} onChange={e => setFormData({ ...formData, legal_person: e.target.value })} />
                                    </div>
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="法人联系电话" value={formData.legal_phone} onChange={e => setFormData({ ...formData, legal_phone: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="注册资本 (万)" value={formData.reg_capital} onChange={e => setFormData({ ...formData, reg_capital: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="省份" value={formData.province} onChange={e => setFormData({ ...formData, province: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="城市" value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })} />
                                    <input className="col-span-2 border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="详细注册地址" value={formData.reg_address} onChange={e => setFormData({ ...formData, reg_address: e.target.value })} />
                                    <textarea className="col-span-2 border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="股东及持股比例情况" value={formData.shareholders} onChange={e => setFormData({ ...formData, shareholders: e.target.value })} />
                                </div>
                            </section>

                            <section className="bg-slate-50 p-5 rounded-2xl space-y-4">
                                <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">3. 财务核算信息</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="财务负责人 / 联络人" value={formData.finance_leader} onChange={e => setFormData({ ...formData, finance_leader: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="发票月度额度 (万)" value={formData.invoice_quota} onChange={e => setFormData({ ...formData, invoice_quota: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="基本账户开户行" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-mono" placeholder="基本账户账号" value={formData.bank_account} onChange={e => setFormData({ ...formData, bank_account: e.target.value })} />
                                </div>
                            </section>

                            <button onClick={handleSubmit} className={`w-full ${editingId ? 'bg-amber-600 shadow-amber-200' : 'bg-slate-900 shadow-slate-200'} text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.01] transition-all active:scale-95`}>
                                {editingId ? '💾 固化档案变更' : '📜 完成法理节点确权'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 print:hidden">
                {/* Search Sidebar */}
                <div className="lg:col-span-1 space-y-6 bg-white p-7 rounded-[2rem] border border-slate-200 shadow-xl print:hidden h-fit sticky top-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2 tracking-tighter">
                            <span className="w-1.5 h-4 bg-indigo-600 rounded-full"></span>
                            集团档案检索
                        </h3>
                        <button onClick={() => setSearchFilters({ name: '', tax_id: '', city: '', legal_person: '', startDate: '', endDate: '' })} className="text-[9px] font-black bg-slate-100 text-slate-400 px-3 py-1.5 rounded-full hover:bg-slate-200 transition-colors uppercase">CLEAR</button>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">实体全称/简称</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="关键字匹配..." value={searchFilters.name} onChange={e => setSearchFilters({ ...searchFilters, name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">法人查找</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all font-bold" placeholder="姓名匹配..." value={searchFilters.legal_person} onChange={e => setSearchFilters({ ...searchFilters, legal_person: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">注册城市</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="例如: 东莞/深圳" value={searchFilters.city} onChange={e => setSearchFilters({ ...searchFilters, city: e.target.value })} />
                        </div>
                        
                        <div className="p-4 bg-indigo-50/50 rounded-2xl space-y-3 border border-indigo-100/50">
                            <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">注册日期区间</label>
                            <div className="space-y-2 text-xs">
                                <input type="date" className="w-full border-none p-2.5 rounded-lg bg-white shadow-sm outline-none" value={searchFilters.startDate} onChange={e => setSearchFilters({...searchFilters, startDate: e.target.value})} />
                                <div className="text-center text-[10px] text-indigo-300 font-bold italic">TO</div>
                                <input type="date" className="w-full border-none p-2.5 rounded-lg bg-white shadow-sm outline-none" value={searchFilters.endDate} onChange={e => setSearchFilters({...searchFilters, endDate: e.target.value})} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main List Area */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white p-7 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">集团档案</h2>
                            {selectedIds.size > 0 && (
                                <button onClick={handleBatchDelete} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-xs font-black border border-rose-100 hover:bg-rose-600 hover:text-white transition-all shadow-lg shadow-rose-100 animate-bounce">
                                    🗑️ 批量移除选中的 {selectedIds.size} 项
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3 w-full md:w-auto items-center flex-wrap justify-end">
                            {canEdit && (
                            <button onClick={startAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl text-[14px] font-black transition-all shadow-xl shadow-indigo-200 active:scale-95">
                                ➕ 新建成员
                            </button>
                            )}
                            {canEdit && (
                            <label className={`cursor-pointer ${isImporting ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-5 py-3 rounded-2xl text-sm font-black flex items-center justify-center transition-all shadow-lg shadow-emerald-100`}>
                                {isImporting ? '数据同步中...' : '📥 批量入库'}
                                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
                            </label>
                            )}
                            {/* 导出按钮（默认当前页，可选全部） */}
                            <div className="relative group">
                                <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-2xl text-sm font-black transition-all shadow-lg shadow-blue-100 flex items-center gap-1.5">
                                    📤 导出
                                    <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                    <button onClick={() => handleExport('page')} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2">
                                        <span className="text-blue-500">📄</span> 导出当前页
                                        <span className="ml-auto text-[10px] text-slate-400 font-normal">({paginatedOrgs.length})</span>
                                    </button>
                                    <button onClick={() => handleExport('all')} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2 border-t border-slate-50">
                                        <span className="text-emerald-500">📋</span> 导出全部
                                        <span className="ml-auto text-[10px] text-slate-400 font-normal">({orgs.length})</span>
                                    </button>
                                </div>
                            </div>
                            <button onClick={() => window.print()} className="bg-slate-100 p-3 rounded-2xl hover:bg-slate-200 transition-colors shadow-sm" title="打印档案">🖨️</button>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[500px]">
                        <div className="flex justify-between items-center px-4 mb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-4">
                            <div className="flex items-center gap-4">
                                <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500" checked={isAllSelected} onChange={e => toggleSelectAll(e.target.checked)} />
                                <span>集团全量节点分布</span>
                            </div>
                            <div className="flex items-center gap-10">
                                <span>基础核实</span>
                                <span>操作权</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {paginatedOrgs.map(org => {
                                const depth = org.path.split('.').length - 1;
                                const isSelected = selectedIds.has(org.id);
                                return (
                                    <div key={org.id} style={{ marginLeft: `${depth * 24}px` }} className={`group relative p-6 rounded-[2rem] border transition-all duration-300 ${isSelected ? 'bg-indigo-50/50 border-indigo-200 shadow-md' : 'bg-white border-slate-100 hover:border-indigo-100 hover:shadow-xl'}`}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex gap-5 flex-1 items-start">
                                                <input type="checkbox" className="mt-1.5 w-5 h-5 rounded-[0.5rem] border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={isSelected} onChange={() => toggleSelectOne(org.id)} />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`text-lg font-black tracking-tight ${depth === 0 ? 'text-indigo-600' : 'text-slate-800'}`}>{org.name}</span>
                                                        <span className="text-[12px] bg-blue-100 text-blue-700 px-2.5 py-1 rounded-xl font-mono font-black">{org.short_name}</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-8 mt-4 text-[13.5px]">
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Credit ID</span><span className="text-slate-600 font-mono font-bold">{org.tax_id}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase font-bold text-indigo-400">Legal Rep</span><span className="text-slate-800 font-black">{org.legal_person || '未维护'}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Reg Date</span><span className="text-emerald-600 font-bold">{org.founded_at || '未披露'}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Current City</span><span className="text-slate-600 font-bold">{org.city || '未知'}</span></p>
                                                    </div>
                                                </div>
                                            </div>
                                            {canEdit && (
                                            <div className="flex gap-2 ml-4 self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEdit(org)} className="text-xs font-black text-indigo-600 bg-white border border-indigo-100 px-5 py-2.5 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm">编辑</button>
                                                <button onClick={() => handleDelete(org.id, org.name)} className="text-xs font-black text-rose-600 bg-white border border-rose-100 px-5 py-2.5 rounded-2xl hover:bg-rose-600 hover:text-white transition-all shadow-sm">删除</button>
                                            </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {paginatedOrgs.length === 0 && <div className="text-center py-24 text-slate-300 font-black uppercase tracking-[0.3em]">No nodes found</div>}
                        </div>

                        {/* Pagination Container */}
                        {filteredOrgs.length > 0 && (
                            <div className="flex flex-col md:flex-row justify-between items-center mt-10 pt-8 border-t border-slate-50 gap-6">
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-slate-400 font-black uppercase tracking-widest">Show Rows</span>
                                    <select className="border border-slate-100 rounded-xl px-4 py-2 text-xs font-black text-slate-700 bg-slate-50 outline-none hover:bg-slate-100 transition-all border-none shadow-inner" value={pageSize} onChange={e => {setPageSize(Number(e.target.value)); setCurrentPage(1);}}>
                                        <option value={10}>10</option>
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                        <option value={500}>500</option>
                                    </select>
                                    <span className="text-[10px] text-slate-300 ml-4 font-black uppercase tracking-widest">Total <span className="text-indigo-600">{filteredOrgs.length}</span> Members Detected</span>
                                </div>
                                
                                <div className="flex gap-3 items-center">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(c => c - 1)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white disabled:opacity-20 transition-all shadow-sm">‹</button>
                                    <div className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-100 min-w-[100px] text-center">
                                        {currentPage} <span className="opacity-50 mx-1">/</span> {totalPages || 1}
                                    </div>
                                    <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(c => c + 1)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white disabled:opacity-20 transition-all shadow-sm">›</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Print View Optimized */}
            <div className="hidden print:block p-10">
                <h1 className="text-3xl font-black text-center mb-12 uppercase tracking-tighter italic border-b-8 border-slate-900 pb-5">海露集团成员企业档案确权总表 (官方版)</h1>
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-slate-900 text-white text-[10px] uppercase font-black tracking-[0.2em] text-center">
                            <th className="p-4 border border-slate-900">架构代码</th>
                            <th className="p-4 border border-slate-900 text-left">实体成员全称</th>
                            <th className="p-4 border border-slate-900">社会信用代码</th>
                            <th className="p-4 border border-slate-900">法定代表人</th>
                            <th className="p-4 border border-slate-900">注册日期</th>
                            <th className="p-4 border border-slate-900">注册城市</th>
                        </tr>
                    </thead>
                    <tbody className="text-[11px] text-center">
                        {filteredOrgs.map(org => (
                            <tr key={org.id} className="border-b border-slate-300">
                                <td className="p-4 font-black text-slate-400">{org.short_name}</td>
                                <td className="p-4 text-left font-black text-[13px]">{org.name}</td>
                                <td className="p-4 font-mono font-bold text-slate-600">{org.tax_id}</td>
                                <td className="p-4 font-black">{org.legal_person}</td>
                                <td className="p-4 font-bold text-emerald-700">{org.founded_at}</td>
                                <td className="p-4 font-black text-slate-900">{org.city}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="mt-12 flex justify-between text-[10px] text-slate-400 font-black uppercase tracking-widest border-t-2 border-slate-100 pt-6">
                    <p>Report Generated: HAILU SC-EMS GLOBAL INFRASTRUCTURE</p>
                    <p>Verified Timestamp: {new Date().toLocaleString()}</p>
                </div>
            </div>
        </div>
    );
}