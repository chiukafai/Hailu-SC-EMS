import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../api/supabase';
import * as XLSX from 'xlsx';

export default function ClientManager({ currentUser, permissionLevel = 'edit' }: { currentUser?: any, permissionLevel?: string }) {
    const canEdit = permissionLevel === 'edit' || permissionLevel === 'head' || permissionLevel === 'admin';
    const [clients, setClients] = useState<any[]>([]);
    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    const [searchFilters, setSearchFilters] = useState({ 
        full_name: '', 
        tax_id: '', 
        risk_level: '', 
        department_name: '',
        startDate: '',
        endDate: ''
    });
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    
    // Reset pagination when search queries change
    useEffect(() => { setCurrentPage(1); }, [searchFilters, clients, pageSize]);

    const initialForm = {
        department_name: '', full_name: '', short_name: '', tax_id: '',
        founded_at: '', legal_person: '', legal_phone: '',
        shareholders: '', reg_capital: '', reg_address: '',
        province: '', city: '', bank_name: '', bank_account: '',
        invoice_quota: '', credit_rating: 'A', taxpayer_type: '一般纳税人',
        risk_level: 'low', added_date: new Date().toISOString().split('T')[0]
    };

    const [formData, setFormData] = useState(initialForm);

    const fetchClients = async () => {
        let allData: any[] = [];
        let start = 0;
        const limit = 1000;
        let hasMore = true;
        let errorOccurred = false;

        while (hasMore) {
            let query = supabase
                .from('global_clients')
                .select(`
                    *,
                    departments:department_id (
                        name
                    )
                `)
                .order('added_date', { ascending: false, nullsFirst: false })
                .range(start, start + limit - 1);
            
            if (permissionLevel === 'head' || permissionLevel === 'edit') {
                if (currentUser?.department_id) {
                    query = query.eq('department_id', currentUser.department_id);
                } else if (currentUser?.id) {
                    query = query.eq('created_by', currentUser.id);
                }
            }

            const { data, error } = await query;
            
            if (error) {
                console.error('Fetch clients error:', error);
                errorOccurred = true;
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
        
        if (errorOccurred && allData.length === 0) {
            // Fallback to simple select if join fails (returns first 1000)
            let fallbackQuery = supabase
                .from('global_clients')
                .select('*')
                .order('added_date', { ascending: false, nullsFirst: false })
                .limit(1000);
                
            if (permissionLevel === 'head' || permissionLevel === 'edit') {
                if (currentUser?.department_id) fallbackQuery = fallbackQuery.eq('department_id', currentUser.department_id);
                else if (currentUser?.id) fallbackQuery = fallbackQuery.eq('created_by', currentUser.id);
            }
            const { data: simpleData } = await fallbackQuery;
            if (simpleData) setClients(simpleData);
        } else if (!errorOccurred || allData.length > 0) {
            setClients(allData.map(c => {
                // Determine if departments is an object or array (Supabase quirk)
                const deptName = Array.isArray(c.departments) 
                    ? c.departments[0]?.name 
                    : c.departments?.name;
                return {
                    ...c,
                    department_name: deptName || ''
                };
            }));
        }

        const { data: deptData } = await supabase.from('departments').select('id, name');
        if (deptData) setAllDepartments(deptData);
    };

    useEffect(() => {
        fetchClients();
    }, [permissionLevel, currentUser]);

    const handleSubmit = async () => {
        if (!formData.full_name || !formData.tax_id) {
            alert("客户全称和信用代码为必填项");
            return;
        }
        let resolvedDeptId = currentUser?.department_id || null;
        if (formData.department_name) {
            const foundDept = allDepartments.find(d => d.name === formData.department_name.trim());
            if (foundDept) resolvedDeptId = foundDept.id;
        }
        
        // Clean payload: ONLY include valid database columns
        const validColumns = [
            'full_name', 'short_name', 'tax_id', 'founded_at', 'legal_person', 
            'legal_phone', 'shareholders', 'reg_capital', 'reg_address', 
            'province', 'city', 'bank_name', 'bank_account', 'invoice_quota', 
            'credit_rating', 'taxpayer_type', 'risk_level', 'added_date'
        ];
        
        const submitData: any = { 
            created_by: currentUser?.id || null, 
            department_id: resolvedDeptId 
        };
        
        // Only copy valid fields from formData, converting empty strings to null for strict typed columns (like dates)
        validColumns.forEach(field => {
            if (field in formData) {
                let val = (formData as any)[field];
                if (val === '') val = null;
                submitData[field] = val;
            }
        });

        if (editingId) {
            const { error } = await supabase.from('global_clients').update(submitData).eq('id', editingId);
            if (error) alert(`更新失败: ${error.message}`);
            else { alert('客户档案更新成功'); resetForm(); fetchClients(); }
        } else {
            const { error } = await supabase.from('global_clients').insert([submitData]);
            if (error) alert(`录入失败: ${error.message}`);
            else { alert('全球客户档案已确权存证'); resetForm(); fetchClients(); }
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`确定要彻底删除客户 [${name}] 吗？`)) {
            const { error } = await supabase.from('global_clients').delete().eq('id', id);
            if (error) alert(error.message);
            else fetchClients();
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (window.confirm(`警告：确定要批量删除选中的 ${selectedIds.size} 条客户档案吗？此操作不可逆！`)) {
            const { error } = await supabase.from('global_clients').delete().in('id', Array.from(selectedIds));
            if (error) alert(error.message);
            else {
                alert('批量删除成功');
                setSelectedIds(new Set());
                fetchClients();
            }
        }
    };

    const startEdit = (client: any) => {
        setEditingId(client.id);
        // Ensure we only pass standard form fields to formData
        const cleanData: any = {};
        Object.keys(initialForm).forEach(key => {
            if (key in client) cleanData[key] = client[key];
        });
        setFormData({ ...initialForm, ...cleanData });
        setIsModalOpen(true);
    };

    const resetForm = () => { setEditingId(null); setFormData(initialForm); setIsModalOpen(false); };
    const startAdd = () => { setEditingId(null); setFormData(initialForm); setIsModalOpen(true); };

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
                '归属部门': 'department_name', '企业法定全称': 'full_name', '客户简称': 'short_name',
                '纳税人识别号': 'tax_id', '成立时间': 'founded_at', '法人姓名': 'legal_person',
                '联系电话': 'legal_phone', '股东信息': 'shareholders', '注册资本': 'reg_capital',
                '详细注册地址': 'reg_address', '省份': 'province', '城市': 'city',
                '开户银行': 'bank_name', '银行账号': 'bank_account', '月度开票限额': 'invoice_quota',
                '信用评级': 'credit_rating', '纳税人类型': 'taxpayer_type', '风控状态': 'risk_level',
                '添加日期': 'added_date'
            };
            const riskMapping: Record<string, string> = { '高风险': 'high', '中风险': 'medium', '准入': 'low', '低风险': 'low' };
            const recordsToInsert = jsonData.map(row => {
                let resolvedDeptId = currentUser?.department_id || null;
                Object.keys(row).forEach(k => {
                    if (k.trim() === '归属部门') {
                        const d = allDepartments.find(dept => dept.name === String(row[k]).trim());
                        if (d) resolvedDeptId = d.id;
                    }
                });
                const newRecord: any = { risk_level: 'low', created_by: currentUser?.id || null, department_id: resolvedDeptId };
                Object.keys(row).forEach(key => {
                    const englishKey = fieldMapping[key.trim()];
                    if (englishKey) {
                        let val = row[key];
                        if (englishKey === 'risk_level') newRecord[englishKey] = riskMapping[String(val)] || 'low';
                        else if ((englishKey === 'founded_at' || englishKey === 'added_date') && typeof val === 'number') {
                            newRecord[englishKey] = new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
                        } else if (englishKey === 'reg_capital' || englishKey === 'invoice_quota') {
                            newRecord[englishKey] = parseFloat(String(val).replace(/[^0-9.-]+/g, '')) || 0;
                        } else newRecord[englishKey] = String(val);
                    }
                });
                return newRecord;
            }).filter(r => r.full_name && r.tax_id);
            const { error } = await supabase.from('global_clients').insert(recordsToInsert);
            if (error) alert(error.message);
            else { alert('导入成功'); fetchClients(); }
        } catch (error: any) { alert(error.message); } finally { setIsImporting(false); if (e.target) e.target.value = ''; }
    };

    const filteredClients = useMemo(() => {
        return clients.filter(c => {
            if (searchFilters.full_name && !c.full_name?.toLowerCase().includes(searchFilters.full_name.toLowerCase()) && !c.short_name?.toLowerCase().includes(searchFilters.full_name.toLowerCase())) return false;
            if (searchFilters.tax_id && !c.tax_id?.toLowerCase().includes(searchFilters.tax_id.toLowerCase())) return false;
            if (searchFilters.risk_level && c.risk_level !== searchFilters.risk_level) return false;
            if (searchFilters.department_name && c.department_name !== searchFilters.department_name) return false;
            
            if (searchFilters.startDate && c.added_date && c.added_date < searchFilters.startDate) return false;
            if (searchFilters.endDate && c.added_date && c.added_date > searchFilters.endDate) return false;
            
            return true;
        });
    }, [clients, searchFilters]);
    
    const paginatedClients = filteredClients.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const totalPages = Math.ceil(filteredClients.length / pageSize);

    const toggleSelectAll = (checked: boolean) => {
        const newSet = new Set(selectedIds);
        paginatedClients.forEach(c => {
            if (checked) newSet.add(c.id);
            else newSet.delete(c.id);
        });
        setSelectedIds(newSet);
    };

    const toggleSelectOne = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const isAllSelected = paginatedClients.length > 0 && paginatedClients.every(c => selectedIds.has(c.id));

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen">
            {/* Modal Form */}
            {isModalOpen && canEdit && (
                <div className="fixed inset-0 z-[100] flex justify-center items-start pt-10 bg-slate-900/40 backdrop-blur-sm print:hidden">
                    <div className="relative w-full max-w-4xl mx-auto max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
                        <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <span className={`w-2 h-6 ${editingId ? 'bg-indigo-500' : 'bg-indigo-600'} rounded-full`}></span>
                                {editingId ? '编辑合作客户档案' : '录入新客户档案'}
                            </h3>
                            <button onClick={resetForm} className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 font-bold w-10 h-10 rounded-full flex items-center justify-center transition-all">✕</button>
                        </div>
                        <div className="p-8 overflow-y-auto flex-1 bg-white space-y-6">
                            <section className="bg-slate-50 p-5 rounded-2xl space-y-4">
                                <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">1. 身份关系与风险评估</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">归属业务部门</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="手动指定部门..." value={formData.department_name} onChange={e => setFormData({ ...formData, department_name: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">档案建立日期</label>
                                        <input type="date" className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" value={formData.added_date} onChange={e => setFormData({ ...formData, added_date: e.target.value })} />
                                    </div>
                                    <div className="col-span-2 space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">企业法定全称*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-black" placeholder="依据营业执照..." value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">客户简称*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="检索用简称" value={formData.short_name} onChange={e => setFormData({ ...formData, short_name: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-slate-400 font-bold ml-1 uppercase">信用代码/税号*</label>
                                        <input className="w-full border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-mono" placeholder="18位社信代码" value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} />
                                    </div>
                                    <select className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-bold" value={formData.risk_level} onChange={e => setFormData({ ...formData, risk_level: e.target.value })}>
                                        <option value="low">评估等级: 低 (准入)</option>
                                        <option value="medium">评估等级: 中 (观察)</option>
                                        <option value="high">评估等级: 高 (禁止)</option>
                                    </select>
                                    <select className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-bold" value={formData.taxpayer_type} onChange={e => setFormData({ ...formData, taxpayer_type: e.target.value })}>
                                        <option value="一般纳税人">一般纳税人</option>
                                        <option value="小规模纳税人">小规模纳税人</option>
                                    </select>
                                </div>
                            </section>
                            <section className="bg-slate-50 p-5 rounded-2xl space-y-4">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">2. 工商登记及银行账户</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <input type="date" className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" value={formData.founded_at} onChange={e => setFormData({ ...formData, founded_at: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-bold" placeholder="法人姓名" value={formData.legal_person} onChange={e => setFormData({ ...formData, legal_person: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="注册资本 (万)" value={formData.reg_capital} onChange={e => setFormData({ ...formData, reg_capital: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="法人联系电话" value={formData.legal_phone} onChange={e => setFormData({ ...formData, legal_phone: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="开户银行" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} />
                                    <input className="border-none p-3.5 rounded-xl text-sm shadow-sm bg-white font-mono" placeholder="银行账号" value={formData.bank_account} onChange={e => setFormData({ ...formData, bank_account: e.target.value })} />
                                    <input className="col-span-2 border-none p-3.5 rounded-xl text-sm shadow-sm bg-white" placeholder="注册/经营详细地址" value={formData.reg_address} onChange={e => setFormData({ ...formData, reg_address: e.target.value })} />
                                </div>
                            </section>
                            <button onClick={handleSubmit} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-100 hover:scale-[1.01] transition-all active:scale-95">
                                {editingId ? '💾 固化合作档案变更' : '📜 完成全球客户确权'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 print:hidden">
                <div className="lg:col-span-1 space-y-6 bg-white p-7 rounded-[2rem] border border-slate-200 shadow-xl print:hidden h-fit sticky top-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2 tracking-tighter">
                            <span className="w-1.5 h-4 bg-indigo-600 rounded-full"></span>
                            多维数据检索
                        </h3>
                        <button onClick={() => setSearchFilters({ full_name: '', tax_id: '', risk_level: '', department_name: '', startDate: '', endDate: '' })} className="text-[9px] font-black bg-slate-100 text-slate-400 px-3 py-1.5 rounded-full hover:bg-slate-200 uppercase">CLEAR</button>
                    </div>
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">企业全称/简称</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="关键字..." value={searchFilters.full_name} onChange={e => setSearchFilters({ ...searchFilters, full_name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">社会信用代码</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="税号检索..." value={searchFilters.tax_id} onChange={e => setSearchFilters({ ...searchFilters, tax_id: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">业务部门</label>
                            <select className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 transition-all font-bold" value={searchFilters.department_name} onChange={e => setSearchFilters({ ...searchFilters, department_name: e.target.value })}>
                                <option value="">=== 全部部门 ===</option>
                                {allDepartments.map((d:any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">风控锁定状态</label>
                            <select className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 transition-all font-bold text-rose-600" value={searchFilters.risk_level} onChange={e => setSearchFilters({ ...searchFilters, risk_level: e.target.value })}>
                                <option value="">正常 / 全部</option>
                                <option value="low">低风险 (PASS)</option>
                                <option value="medium">观察期 (WATCH)</option>
                                <option value="high">已锁定 (BLOCK)</option>
                            </select>
                        </div>
                        <div className="p-4 bg-indigo-50/50 rounded-2xl space-y-3 border border-indigo-100/50">
                            <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">档案建立日期区间</label>
                            <div className="space-y-2 text-xs">
                                <input type="date" className="w-full border-none p-2.5 rounded-lg bg-white shadow-sm outline-none" value={searchFilters.startDate} onChange={e => setSearchFilters({...searchFilters, startDate: e.target.value})} />
                                <div className="text-center text-[10px] text-indigo-300 font-bold italic">TO</div>
                                <input type="date" className="w-full border-none p-2.5 rounded-lg bg-white shadow-sm outline-none" value={searchFilters.endDate} onChange={e => setSearchFilters({...searchFilters, endDate: e.target.value})} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white p-7 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">合作客户档案</h2>
                            {selectedIds.size > 0 && (
                                <button onClick={handleBatchDelete} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-xs font-black border border-rose-100 hover:bg-rose-600 hover:text-white transition-all shadow-lg animate-bounce">
                                    🗑️ 批量移除选中的 {selectedIds.size} 项
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3 w-full md:w-auto items-center flex-wrap justify-end">
                            {canEdit && (
                            <button onClick={startAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl text-[14px] font-black transition-all shadow-xl shadow-indigo-200 active:scale-95">➕ 录入客户</button>
                            )}
                            {canEdit && (
                            <label className={`cursor-pointer ${isImporting ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-5 py-3 rounded-2xl text-sm font-black flex items-center transition-all shadow-lg`}>
                                {isImporting ? '处理中...' : '📥 批量导入'}
                                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
                            </label>
                            )}
                            <button onClick={() => window.print()} className="bg-slate-100 p-3 rounded-2xl hover:bg-slate-200 transition-colors shadow-sm" title="打印档案">🖨️</button>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[500px]">
                        <div className="flex justify-between items-center px-4 mb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-4">
                            <div className="flex items-center gap-4">
                                <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500" checked={isAllSelected} onChange={e => toggleSelectAll(e.target.checked)} />
                                <span>批量操作</span>
                            </div>
                            <div className="hidden md:flex items-center gap-10">
                                <span>风险核实</span>
                                <span>操作权</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {paginatedClients.map(client => {
                                const isSelected = selectedIds.has(client.id);
                                return (
                                    <div key={client.id} className={`group relative p-6 rounded-[2rem] border transition-all duration-300 ${isSelected ? 'bg-indigo-50/50 border-indigo-200 shadow-md' : 'bg-white border-slate-100 hover:border-indigo-100 hover:shadow-xl'}`}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex gap-5 flex-1 items-start">
                                                <input type="checkbox" className="mt-1.5 w-5 h-5 rounded-[0.5rem] border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={isSelected} onChange={() => toggleSelectOne(client.id)} />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-lg font-black tracking-tight text-slate-800">{client.full_name}</span>
                                                        <span className="text-[12px] bg-slate-900/10 text-slate-900 px-2 py-0.5 rounded-lg font-mono font-black">{client.short_name}</span>
                                                        {client.department_name && <span className="text-[12px] font-black border border-indigo-600 text-indigo-600 px-3 py-0.5 rounded-full lowercase tracking-tighter">@{client.department_name}</span>}
                                                    </div>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-8 mt-4 text-[12px]">
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Tax ID</span><span className="text-slate-600 font-mono font-bold">{client.tax_id}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Legal Rep</span><span className="text-slate-800 font-black">{client.legal_person || '未设置'}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-indigo-400 uppercase">Added Date</span><span className="text-indigo-600 font-black">{client.added_date || '未设置'}</span></p>
                                                        <p className="flex flex-col gap-0.5"><span className="text-[9px] font-black text-slate-300 uppercase">Status</span><span className={`font-black ${client.risk_level === 'high' ? 'text-rose-600' : client.risk_level === 'medium' ? 'text-amber-500' : 'text-emerald-500'}`}>{client.risk_level === 'high' ? 'BLOCK' : client.risk_level === 'medium' ? 'WATCH' : 'STABLE'}</span></p>

                                                    </div>
                                                </div>
                                            </div>
                                            {canEdit && (
                                            <div className="flex gap-2 ml-4 self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEdit(client)} className="text-xs font-black text-indigo-600 bg-white border border-indigo-100 px-5 py-2.5 rounded-2xl hover:bg-indigo-600 hover:text-white shadow-sm">编辑</button>
                                                <button onClick={() => handleDelete(client.id, client.full_name)} className="text-xs font-black text-rose-600 bg-white border border-rose-100 px-5 py-2.5 rounded-2xl hover:bg-rose-600 hover:text-white shadow-sm">删除</button>
                                            </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {paginatedClients.length === 0 && <div className="text-center py-24 text-slate-300 font-black uppercase tracking-[0.3em]">No records found</div>}
                        </div>

                        {filteredClients.length > 0 && (
                            <div className="flex flex-col md:flex-row justify-between items-center mt-10 pt-8 border-t border-slate-50 gap-6">
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-slate-400 font-black uppercase tracking-widest">Rows</span>
                                    <select className="border-none rounded-xl px-4 py-2 text-xs font-black text-slate-700 bg-slate-50 shadow-inner" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                                        <option value={10}>10</option>
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                        <option value={500}>500</option>
                                    </select>
                                    <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest">Global pool total: {filteredClients.length} records</span>
                                </div>
                                <div className="flex gap-3 items-center">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(c => c - 1)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white transition-all shadow-sm disabled:opacity-20 text-xs">PREV</button>
                                    <div className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black shadow-lg min-w-[100px] text-center">{currentPage} / {totalPages || 1}</div>
                                    <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(c => c + 1)} className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white transition-all shadow-sm disabled:opacity-20 text-xs">NEXT</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Print View */}
            <div className="hidden print:block p-10">
                <h1 className="text-3xl font-black text-center mb-12 uppercase tracking-tighter italic border-b-8 border-slate-900 pb-5">海露集团合作客户确权档案 (官方核定版)</h1>
                <table className="w-full border-collapse">
                    <thead className="bg-slate-900 text-white text-[10px] uppercase font-black tracking-[0.2em] text-center">
                        <tr>
                            <th className="p-4 border border-slate-900">内控部门</th>
                            <th className="p-4 border border-slate-900 text-left">伙伴企业法定全称</th>
                            <th className="p-4 border border-slate-900">纳税识别号</th>
                            <th className="p-4 border border-slate-900">添加日期</th>
                            <th className="p-4 border border-slate-900">风险等级</th>
                        </tr>
                    </thead>
                    <tbody className="text-[11px] text-center">
                        {filteredClients.map(c => (
                            <tr key={c.id} className="border-b border-slate-300">
                                <td className="p-4 font-black text-slate-400">@{c.department_name}</td>
                                <td className="p-4 text-left font-black text-[13px]">{c.full_name}</td>
                                <td className="p-4 font-mono text-slate-600">{c.tax_id}</td>
                                <td className="p-4 font-bold text-indigo-700">{c.added_date}</td>
                                <td className="p-4 font-black">{c.risk_level === 'high' ? '已锁定' : '准入'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}