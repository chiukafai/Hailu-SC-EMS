import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../api/supabase';
import * as XLSX from 'xlsx';

function EditableRemark({ value, onSave, readonly }: { value?: string, onSave: (val: string) => void, readonly?: boolean }) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempVal, setTempVal] = useState(value || '');

    const handleSave = () => {
        setIsEditing(false);
        if (tempVal !== value) {
            onSave(tempVal);
        }
    };

    if (readonly) {
        return value ? <div className="text-[10px] text-slate-500 mt-1 truncate" title={value}>📝 {value}</div> : null;
    }

    if (isEditing) {
        return (
            <input 
                type="text" 
                autoFocus
                className="w-[100px] text-[10px] p-0.5 border border-indigo-200 rounded outline-none focus:ring-1 focus:ring-indigo-400 mt-1"
                value={tempVal}
                onChange={e => setTempVal(e.target.value)}
                onBlur={handleSave}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
        );
    }

    return (
        <div 
            className="text-[10px] text-slate-500 cursor-pointer hover:bg-slate-100 p-0.5 rounded truncate transition-colors mt-1 w-full"
            onClick={() => setIsEditing(true)}
            title={value || '点击添加备注'}
        >
            {value ? <span className="text-slate-600 italic">📝 {value}</span> : <span className="text-slate-400 italic opacity-40 hover:opacity-100 transition-opacity">✏️ 点击添加备注</span>}
        </div>
    );
}

function MatchingModal({ isOpen, onClose, invoice, onConfirm, clients }: { isOpen: boolean, onClose: () => void, invoice: any, onConfirm: (tradeId: string, amount: number) => void, clients: any[] }) {
    const [trades, setTrades] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: '',
        query: ''
    });
    const [allocatedAmount, setAllocatedAmount] = useState<string>('');

    useEffect(() => {
        if (isOpen && invoice) {
            // Default range: 3 months before, 1 week after issue date
            const date = new Date(invoice.issue_date);
            const start = new Date(date);
            start.setMonth(start.getMonth() - 3);
            const end = new Date(date);
            end.setDate(end.getDate() + 7);
            
            setFilters({
                startDate: start.toISOString().split('T')[0],
                endDate: end.toISOString().split('T')[0],
                query: invoice.buyer_name || ''
            });
            setAllocatedAmount(String(invoice.amount || '0'));
            searchTrades(invoice.buyer_name || '', start.toISOString().split('T')[0], end.toISOString().split('T')[0]);
        }
    }, [isOpen, invoice]);

    const searchTrades = async (q: string, start: string, end: string) => {
        setLoading(true);
        let query = supabase.from('invoices').select('*, organizations(name)');
        
        if (q) {
            // Search by project_name, product_info or trade_location
            // For complex cross-table searches (clients), it's easier to search by project text
            query = query.or(`project_name.ilike.%${q}%,product_info.ilike.%${q}%,trade_location.ilike.%${q}%`);
        }
        if (start) query = query.gte('trade_date', start);
        if (end) query = query.lte('trade_date', end);
        
        const { data, error } = await query.order('trade_date', { ascending: false }).limit(20);
        if (error) console.error(error);
        else setTrades(data || []);
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-8 bg-indigo-600 text-white flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-black tracking-tight">关联贸易单据</h3>
                        <p className="text-xs text-indigo-100 mt-1 opacity-80">当前发票金额: ¥ {(invoice.amount || 0).toLocaleString()}</p>
                    </div>
                    <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>

                <div className="p-8 flex-1 overflow-y-auto space-y-6">
                    <div className="grid grid-cols-3 gap-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">开始日期</label>
                            <input type="date" className="w-full border-none p-2.5 rounded-xl bg-white shadow-sm text-xs" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">结束日期</label>
                            <input type="date" className="w-full border-none p-2.5 rounded-xl bg-white shadow-sm text-xs" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">客户名称搜索</label>
                            <input className="w-full border-none p-2.5 rounded-xl bg-white shadow-sm text-xs" placeholder="搜索购方名称..." value={filters.query} onChange={e => setFilters({...filters, query: e.target.value})} />
                        </div>
                        <div className="col-span-3">
                            <button onClick={() => searchTrades(filters.query, filters.startDate, filters.endDate)} className="w-full bg-indigo-50 text-indigo-600 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition-colors uppercase tracking-widest">
                                刷新搜索
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase px-1">候选贸易单据</label>
                        <div className="border rounded-3xl overflow-hidden min-h-[200px]">
                            <table className="w-full text-xs bg-white">
                                <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase">
                                    <tr>
                                        <th className="p-4 text-left">单据日期</th>
                                        <th className="p-4 text-left">项目名称/客户</th>
                                        <th className="p-4 text-right">总金额</th>
                                        <th className="p-4 text-center">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {loading ? (
                                        <tr><td colSpan={4} className="p-10 text-center text-slate-400 animate-pulse">正在查找单据...</td></tr>
                                    ) : trades.length === 0 ? (
                                        <tr><td colSpan={4} className="p-10 text-center text-slate-400">未找到符合条件的未结清贸易单据</td></tr>
                                    ) : trades.map(t => (
                                        <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="p-4 font-mono font-bold text-slate-500">{t.trade_date}</td>
                                            <td className="p-4">
                                                <div className="font-bold text-slate-800">{t.project_name || '未命名项目'}</div>
                                                <div className="text-[10px] text-slate-400">
                                                    🤝 {clients.find(c => c.tax_id === t.client_tax_id)?.full_name || t.client_tax_id || '未知客户'}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right font-black text-slate-700">¥ {(t.amount || 0).toLocaleString()}</td>
                                            <td className="p-4 text-center">
                                                <div className="flex items-center justify-end gap-2">
                                                    <input 
                                                        type="number" 
                                                        className="w-24 p-1.5 border rounded-lg text-right" 
                                                        placeholder="分配额" 
                                                        defaultValue={allocatedAmount}
                                                        onChange={e => setAllocatedAmount(e.target.value)}
                                                    />
                                                    <button 
                                                        onClick={() => onConfirm(t.id, parseFloat(allocatedAmount))}
                                                        className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition-shadow shadow-sm active:scale-95"
                                                    >
                                                        关联
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="p-8 bg-slate-50 border-t flex justify-end">
                    <button onClick={onClose} className="bg-white border text-slate-600 px-6 py-2.5 rounded-2xl font-black text-sm hover:bg-slate-100 transition-colors">
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function TaxInvoiceManager({ permissionLevel = 'edit', currentUser }: { permissionLevel?: string, currentUser?: any }) {
    const canEdit = permissionLevel === 'edit' || permissionLevel === 'head' || permissionLevel === 'admin';
    const [invoices, setInvoices] = useState<any[]>([]);
    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    
    // Search Filters
    const [searchFilters, setSearchFilters] = useState({ 
        seller_name: '', 
        buyer_name: '', 
        invoice_code: '', 
        digital_invoice_number: '',
        startDate: '',
        endDate: '',
        department_name: ''
    });

    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [isImporting, setIsImporting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [linkingInvoice, setLinkingInvoice] = useState<any | null>(null);
    const [links, setLinks] = useState<Record<string, any[]>>({});
    const [clients, setClients] = useState<any[]>([]);
    
    // Reset pagination when search queries change
    useEffect(() => { setCurrentPage(1); }, [searchFilters, invoices, pageSize]);

    useEffect(() => {
        const fetchClients = async () => {
            const { data } = await supabase.from('global_clients').select('*');
            if (data) setClients(data);
        };
        fetchClients();
    }, []);

    const fetchLinks = async (invoiceIds: string[]) => {
        if (invoiceIds.length === 0) return;
        const { data, error } = await supabase
            .from('tax_invoice_trade_links')
            .select('*')
            .in('tax_invoice_id', invoiceIds);
        
        if (error) console.error('Fetch links error:', error);
        else {
            const linkMap: Record<string, any[]> = {};
            data?.forEach(link => {
                if (!linkMap[link.tax_invoice_id]) linkMap[link.tax_invoice_id] = [];
                linkMap[link.tax_invoice_id].push(link);
            });
            setLinks(prev => ({ ...prev, ...linkMap }));
        }
    };

    const fetchInvoices = async () => {
        let allData: any[] = [];
        let start = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = supabase
                .from('tax_invoices')
                .select(`
                    *,
                    departments:department_id (name)
                `)
                .order('issue_date', { ascending: false, nullsFirst: false })
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
                console.error('Fetch tax_invoices error:', error);
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
        
        if (allData.length > 0) {
            const mappedInvoices = allData.map(inv => {
                const deptName = Array.isArray(inv.departments) ? inv.departments[0]?.name : inv.departments?.name;
                return { ...inv, department_name: deptName || '' };
            });
            setInvoices(mappedInvoices);
            fetchLinks(mappedInvoices.map(i => i.id));
        } else {
            setInvoices([]);
        }

        const { data: deptData } = await supabase.from('departments').select('id, name');
        if (deptData) setAllDepartments(deptData);
    };

    useEffect(() => {
        fetchInvoices();
    }, [permissionLevel, currentUser]);

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (window.confirm(`警告：确定要批量彻底删除选中的 ${selectedIds.size} 条发票明细吗？此操作不可逆！`)) {
            const idsToDelete = Array.from(selectedIds);
            const chunkSize = 100; // Supabase/PostgREST URI limit safety
            let hasError = false;
            let errorMessage = '';

            for (let i = 0; i < idsToDelete.length; i += chunkSize) {
                const chunk = idsToDelete.slice(i, i + chunkSize);
                const { error } = await supabase.from('tax_invoices').delete().in('id', chunk);
                if (error) {
                    hasError = true;
                    errorMessage = error.message;
                    break;
                }
            }

            if (hasError) {
                alert('部分删除失败: ' + errorMessage);
            } else {
                alert('批量删除成功');
                setSelectedIds(new Set());
                fetchInvoices();
            }
        }
    };

    const handleClearAll = async () => {
        const confirm = window.prompt('【危险】此操作将清空整个发票库当前权限下的全量数据！此操作不可逆！\n如果您确定要清空错链数据，请在下方输入 "CLEAR" 以确认执行：');
        if (confirm === 'CLEAR') {
            let q = supabase.from('tax_invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (permissionLevel !== 'admin') {
                if (currentUser?.department_id) q = q.eq('department_id', currentUser.department_id);
                else q = q.eq('created_by', currentUser?.id);
            }
            const { error } = await q;
            if (error) alert('清空失败: ' + error.message);
            else {
                alert('已彻底清空数据！');
                setSelectedIds(new Set());
                fetchInvoices();
            }
        }
    };

    const handleUpdateRemark = async (id: string, newRemarks: string) => {
        const { error } = await supabase.from('tax_invoices').update({ remarks: newRemarks }).eq('id', id);
        if (error) {
            alert('备注保存失败: ' + error.message);
        } else {
            setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, remarks: newRemarks } : inv));
        }
    };

    const handleConfirmLink = async (tradeId: string, amount: number) => {
        if (!linkingInvoice) return;
        const { error } = await supabase.from('tax_invoice_trade_links').insert({
            tax_invoice_id: linkingInvoice.id,
            trade_id: tradeId,
            allocated_amount: amount
        });

        if (error) {
            if (error.code === '23505') alert('该发票已与此贸易单机关联过，请勿重复关联。');
            else alert('关联失败: ' + error.message);
        } else {
            alert('关联成功');
            setLinkingInvoice(null);
            fetchLinks([linkingInvoice.id]);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            
            const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
            if (!rows || rows.length === 0) {
                alert('模板为空，请检查文件内容。');
                setIsImporting(false);
                if (e.target) e.target.value = ''; 
                return;
            }

            // Fingerprint Scan: Scan first 10 rows to find the actual header row
            let headerRowIndex = -1;
            for (let i = 0; i < Math.min(10, rows.length); i++) {
                const rowStr = (rows[i] || []).join('');
                if (rowStr.includes('销方名称') || rowStr.includes('发票代码') || rowStr.includes('购买方名称') || rowStr.includes('发票号') || rowStr.includes('数电')) {
                    if (rowStr.includes('销方名称') || rowStr.includes('购买方名称') || rowStr.includes('发票种类') || rowStr.includes('发票票种')) {
                        headerRowIndex = i;
                        break;
                    }
                }
            }

            if (headerRowIndex === -1) {
                alert('模板校验失败：未能找准发票明细的表头起始行。\n请确保上传的是【发票明细表模板】或规范的发票导出表，而非【业务贸易数据模板】。');
                setIsImporting(false);
                if (e.target) e.target.value = ''; 
                return;
            }
            
            const fieldMapping: Record<string, string> = {
                // =============== 官方税务局【全量发票查询导出】模板 ===============
                '序号': 'serial_number',
                '发票票种': 'invoice_type',
                '销方名称': 'seller_name',
                '年月': 'year_month',
                '发票代码': 'invoice_code',
                '数电发票号码': 'digital_invoice_number',
                '购方识别号': 'buyer_tax_id',
                '购买方名称': 'buyer_name',
                '开票日期': 'issue_date',
                '货物或应税劳务名称': 'item_name',
                '补开月份': 'supp_month',
                '单位': 'unit',
                '数量': 'quantity',
                '单价': 'unit_price',
                '金额': 'amount',
                '税率': 'tax_rate',
                '品种': 'tax_category',
                '税额': 'tax_amount',
                '校验码': 'check_code',
                '是否有签注': 'has_signature',
                '备注': 'remarks',

                // =============== 第三方开票软件【invoiceList】专属映射别名 ===============
                '流水号': 'serial_number',
                '发票种类': 'invoice_type',
                '发票号码': 'digital_invoice_number', // 当缺失数电号码时降级使用
                '数电票号码': 'digital_invoice_number',
                '购方名称': 'buyer_name',
                '购方税号': 'buyer_tax_id',
                '开票时间': 'issue_date',
                '商品名称': 'item_name',
                '单价（不含税）': 'unit_price',
                '含税单价': 'unit_price',
                '不含税金额': 'amount',
                '含税金额': 'amount', // Fallback
                // '备注' 依然复用上方的映射
            };

            const actualHeaders = rows[headerRowIndex];
            const dataRows = rows.slice(headerRowIndex + 1);

            const recordsToInsert = dataRows.map(rowArray => {
                const newRecord: any = { 
                    created_by: currentUser?.id || null, 
                    department_id: currentUser?.department_id || null 
                };
                actualHeaders.forEach((header: any, index: number) => {
                    const englishKey = fieldMapping[String(header || '').trim()];
                    if (englishKey) {
                        let val = rowArray[index];
                        if (val === undefined || val === null) val = '';
                        // 优先保留非空的真值，防止例如“发票号码”把“数电发票号码”覆盖为空
                        if (!val && val !== 0 && newRecord[englishKey]) return;

                        if (englishKey === 'issue_date') {
                            if (typeof val === 'number') {
                                newRecord[englishKey] = new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
                            } else if (typeof val === 'string') {
                                const parsedDate = val.trim().split(' ')[0].replace(/\//g, '-');
                                // Regex check for YYYY-MM-DD
                                if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(parsedDate)) {
                                    newRecord[englishKey] = parsedDate;
                                }
                            }
                        } else if (['quantity', 'unit_price', 'amount', 'tax_amount'].includes(englishKey)) {
                            newRecord[englishKey] = parseFloat(String(val).replace(/[^0-9.-]+/g, '')) || 0;
                        } else {
                            if (!newRecord[englishKey] || String(val).length > String(newRecord[englishKey]).length) {
                                newRecord[englishKey] = String(val).trim();
                            }
                        }
                    }
                });
                return newRecord;
            }).filter(r => {
                const serialStr = String(r.serial_number || '');
                const codeStr = String(r.invoice_code || '');
                const digitalStr = String(r.digital_invoice_number || '');

                // 排除各种形式的 "合计" 或尾注统计行（通常带有中文字符出现在不该出现的地方）
                const hasChinese = /[\u4e00-\u9fa5]/;
                
                // 单据号、发票代码、数电号码绝不可能包含中文字符，一旦包含必定是Excel下方的统计行（如：发票开具数量：）
                const isFooterBlock = hasChinese.test(serialStr) || hasChinese.test(codeStr) || hasChinese.test(digitalStr);
                                  
                // 必须具备实质性的发票数据载体
                const hasCoreData = r.amount || r.invoice_code || r.digital_invoice_number;

                return !isFooterBlock && hasCoreData;
            });

            // Chunk inserts by 500 to prevent large payload limits
            const chunkSize = 500;
            for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
                const chunk = recordsToInsert.slice(i, i + chunkSize);
                const { error } = await supabase.from('tax_invoices').insert(chunk);
                if (error) {
                    alert(`导入中断于第 ${i} 行: ${error.message}`);
                    break;
                }
            }
            alert('导入发票明细成功');
            fetchInvoices();
        } catch (error: any) { 
            alert('解析失败: ' + error.message); 
        } finally { 
            setIsImporting(false); 
            if (e.target) e.target.value = ''; 
        }
    };

    const filteredInvoices = useMemo(() => {
        return invoices.filter(c => {
            if (searchFilters.seller_name && !c.seller_name?.toLowerCase().includes(searchFilters.seller_name.toLowerCase())) return false;
            if (searchFilters.buyer_name && !c.buyer_name?.toLowerCase().includes(searchFilters.buyer_name.toLowerCase())) return false;
            if (searchFilters.invoice_code && !c.invoice_code?.toLowerCase().includes(searchFilters.invoice_code.toLowerCase())) return false;
            if (searchFilters.digital_invoice_number && !c.digital_invoice_number?.toLowerCase().includes(searchFilters.digital_invoice_number.toLowerCase())) return false;
            if (searchFilters.department_name && c.department_name !== searchFilters.department_name) return false;
            if (searchFilters.startDate && c.issue_date && c.issue_date < searchFilters.startDate) return false;
            if (searchFilters.endDate && c.issue_date && c.issue_date > searchFilters.endDate) return false;
            return true;
        });
    }, [invoices, searchFilters]);

    const paginatedInvoices = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredInvoices.slice(start, start + pageSize);
    }, [filteredInvoices, currentPage, pageSize]);

    const totalPages = Math.ceil(filteredInvoices.length / pageSize) || 1;

    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(paginatedInvoices.map(i => i.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const toggleSelectOne = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const isAllSelected = paginatedInvoices.length > 0 && selectedIds.size === paginatedInvoices.length;

    // Aggregated Metrics
    const totalAmount = useMemo(() => filteredInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0), [filteredInvoices]);
    const totalTax = useMemo(() => filteredInvoices.reduce((sum, i) => sum + (Number(i.tax_amount) || 0), 0), [filteredInvoices]);

    return (
        <div className="max-w-[1600px] mx-auto px-4 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Search Sidebar */}
                <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm h-fit space-y-8 sticky top-24">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2 tracking-tighter">
                            <span className="w-1.5 h-4 bg-indigo-600 rounded-full"></span>
                            多维数据检索
                        </h3>
                        <button onClick={() => setSearchFilters({ seller_name: '', buyer_name: '', invoice_code: '', digital_invoice_number: '', department_name: '', startDate: '', endDate: '' })} className="text-[9px] font-black bg-slate-100 text-slate-400 px-3 py-1.5 rounded-full hover:bg-slate-200 uppercase">CLEAR</button>
                    </div>
                    
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">销方名称</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="关键字..." value={searchFilters.seller_name} onChange={e => setSearchFilters({ ...searchFilters, seller_name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">购方名称</label>
                            <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="关键字..." value={searchFilters.buyer_name} onChange={e => setSearchFilters({ ...searchFilters, buyer_name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">业务部门</label>
                            <select className="w-full border-none bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 transition-all font-bold" value={searchFilters.department_name} onChange={e => setSearchFilters({ ...searchFilters, department_name: e.target.value })}>
                                <option value="">=== 全部部门 ===</option>
                                {allDepartments.map((d:any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">发票代码</label>
                                <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-xs font-mono focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="..." value={searchFilters.invoice_code} onChange={e => setSearchFilters({ ...searchFilters, invoice_code: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">数电号码</label>
                                <input className="w-full border-none bg-slate-50 p-3 rounded-xl text-xs font-mono focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="..." value={searchFilters.digital_invoice_number} onChange={e => setSearchFilters({ ...searchFilters, digital_invoice_number: e.target.value })} />
                            </div>
                        </div>
                        <div className="p-4 bg-indigo-50/50 rounded-2xl space-y-3 border border-indigo-100/50 mt-4">
                            <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest pl-1">开票日期区间</label>
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
                            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">发票明细档案</h2>
                            {selectedIds.size > 0 && (
                                <button onClick={handleBatchDelete} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-xs font-black border border-rose-100 hover:bg-rose-600 hover:text-white transition-all shadow-lg animate-bounce">
                                    🗑️ 批量移除选中的 {selectedIds.size} 项
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3 w-full md:w-auto items-center flex-wrap justify-end">
                            {canEdit && (
                            <>
                                <button onClick={handleClearAll} className="bg-rose-50 text-rose-600 px-5 py-3 rounded-2xl text-sm font-black flex items-center transition-all shadow-sm hover:bg-rose-600 hover:text-white border border-rose-100">
                                    🧨 一键清空当前可见数据
                                </button>
                                <label className={`cursor-pointer ${isImporting ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-5 py-3 rounded-2xl text-sm font-black flex items-center transition-all shadow-lg`}>
                                    {isImporting ? '处理中...' : '📥 批量导入发票模板'}
                                    <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
                                </label>
                            </>
                            )}
                        </div>
                    </div>

                    {/* Stats Metrics */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-indigo-600 p-6 rounded-[2rem] text-white shadow-lg shadow-indigo-200">
                            <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">检索结果发票数</p>
                            <p className="text-3xl font-black flex items-baseline gap-2">{filteredInvoices.length} <span className="text-sm font-normal text-indigo-200">张</span></p>
                        </div>
                        <div className="bg-white border p-6 rounded-[2rem] shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">发票总金额</p>
                            <p className="text-2xl font-black text-slate-800 flex items-baseline gap-2">
                                <span className="text-sm">¥</span>{totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}
                            </p>
                        </div>
                        <div className="bg-white border p-6 rounded-[2rem] shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">发票总税额</p>
                            <p className="text-2xl font-black text-slate-800 flex items-baseline gap-2">
                                <span className="text-sm">¥</span>{totalTax.toLocaleString(undefined, {minimumFractionDigits: 2})}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm min-h-[500px] overflow-hidden">
                        <div className="flex items-center gap-4 px-4 mb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-4">
                            <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={isAllSelected} onChange={e => toggleSelectAll(e.target.checked)} />
                            <div className="flex-1 grid grid-cols-12 gap-4">
                                <div className="col-span-2">类型及号码</div>
                                <div className="col-span-3">购销双方</div>
                                <div className="col-span-3">商品明细</div>
                                <div className="col-span-2 text-right">金额及税额</div>
                                <div className="col-span-2 text-right">开票日期</div>
                            </div>
                        </div>
                        
                        <div className="overflow-x-auto no-scrollbar">
                            <div className="min-w-[1000px] space-y-3 pb-6">
                                {paginatedInvoices.map(inv => {
                                    const isSelected = selectedIds.has(inv.id);
                                    return (
                                        <div key={inv.id} className={`flex items-center gap-4 p-4 rounded-[1.5rem] border transition-all ${isSelected ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50/50 border-transparent hover:bg-white hover:border-slate-100 hover:shadow-md'}`}>
                                            <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={isSelected} onChange={() => toggleSelectOne(inv.id)} />
                                            
                                            <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                                                <div className="col-span-2 space-y-1.5 flex flex-col justify-center">
                                                    <div><span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-1 rounded-md font-black inline-block text-center whitespace-normal break-words leading-tight">{inv.invoice_type || '未知'}</span></div>
                                                    <div className="text-[10px] text-slate-500 font-mono font-bold" title="发票号码">{inv.digital_invoice_number || inv.invoice_code || '--'}</div>
                                                </div>

                                                <div className="col-span-3 space-y-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md whitespace-nowrap border border-rose-100 shrink-0">销</span>
                                                        <span className="text-[11px] text-slate-800 font-bold truncate" title={inv.seller_name}>{inv.seller_name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md whitespace-nowrap border border-blue-100 shrink-0">购</span>
                                                        <span className="text-[11px] text-slate-800 font-bold truncate" title={inv.buyer_name}>{inv.buyer_name}</span>
                                                    </div>
                                                </div>

                                                <div className="col-span-3 flex flex-col justify-center">
                                                    <p className="text-[11px] text-slate-800 font-bold truncate mb-1" title={inv.item_name}>{inv.item_name || '--'}</p>
                                                    { (inv.quantity || inv.unit_price) ? (
                                                        <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded-md" title="数量及单位">{inv.quantity || '-'} {inv.unit || ''}</span>
                                                            <span className="text-slate-400">×</span>
                                                            <span className="text-slate-600 font-bold" title="单价">¥ {Number(inv.unit_price || 0).toLocaleString()}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[10px] text-slate-400 italic">无明细参数</div>
                                                    )}
                                                </div>

                                                <div className="col-span-2 text-right space-y-0.5 flex flex-col justify-center items-end">
                                                    <p className="text-[13px] text-slate-800 font-black" title="已剔除税额的发票金额">¥ {(Number(inv.amount)||0).toLocaleString()}</p>
                                                    <p className="text-[11px] text-indigo-600 font-black" title="税款金额">¥ {(Number(inv.tax_amount)||0).toLocaleString()}</p>
                                                </div>

                                                <div className="col-span-2 text-right flex flex-col justify-center items-end space-y-1">
                                                    <p className="text-[10px] font-mono font-bold text-slate-600 bg-slate-50 inline-block px-1.5 py-1 rounded-lg border border-slate-100 whitespace-nowrap">{inv.issue_date || '--'}</p>
                                                    <div className="w-full text-right" onClick={(e) => e.stopPropagation()}>
                                                        <EditableRemark value={inv.remarks} readonly={!canEdit} onSave={(val) => handleUpdateRemark(inv.id, val)} />
                                                    </div>
                                                    {canEdit && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setLinkingInvoice(inv); }}
                                                            className={`text-[9px] font-black px-2 py-1 rounded-md transition-all border ${links[inv.id]?.length > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100 font-bold' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white'}`}
                                                        >
                                                            {links[inv.id]?.length > 0 
                                                                ? `🔗 已关联 (¥${links[inv.id].reduce((acc, l) => acc + (l.allocated_amount || 0), 0).toLocaleString()})` 
                                                                : '🔗 关联单据'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {paginatedInvoices.length === 0 && (
                                    <div className="text-center py-20 text-slate-400 font-bold">没有找到匹配的发票记录。</div>
                                )}
                            </div>
                        </div>

                        {filteredInvoices.length > 0 && (
                            <div className="flex justify-between items-center mt-6 pt-6 border-t border-slate-100 px-2">
                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold text-slate-400">
                                        Displaying {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredInvoices.length)} of {filteredInvoices.length} records
                                    </span>
                                    <select 
                                        className="text-xs border-none bg-slate-50 text-slate-600 font-black rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-100 hover:bg-slate-100 cursor-pointer transition-colors"
                                        value={pageSize}
                                        onChange={(e) => {
                                            setPageSize(Number(e.target.value));
                                            setCurrentPage(1);
                                        }}
                                    >
                                        <option value={50}>50 / 页</option>
                                        <option value={100}>100 / 页</option>
                                        <option value={500}>500 / 页</option>
                                        <option value={1000}>1000 / 页</option>
                                    </select>
                                </div>
                                
                                {totalPages > 1 && (
                                    <div className="flex gap-2">
                                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-5 py-2.5 rounded-xl bg-slate-50 text-slate-600 font-bold text-xs disabled:opacity-50 hover:bg-slate-100 transition-colors">Prev</button>
                                        <span className="px-5 py-2.5 rounded-xl bg-indigo-50 text-indigo-600 font-black text-xs">{currentPage} / {totalPages}</span>
                                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-5 py-2.5 rounded-xl bg-slate-50 text-slate-600 font-bold text-xs disabled:opacity-50 hover:bg-slate-100 transition-colors">Next</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <MatchingModal 
                isOpen={!!linkingInvoice} 
                onClose={() => setLinkingInvoice(null)} 
                invoice={linkingInvoice} 
                onConfirm={handleConfirmLink}
                clients={clients}
            />
        </div>
    );
}
