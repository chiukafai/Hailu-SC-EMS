import React, { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';
import * as XLSX from 'xlsx';

export default function InvoiceManager({ permissionLevel = 'edit', currentUser }: { permissionLevel?: string, currentUser?: any }) {
    const canEdit = permissionLevel === 'edit';
    const [records, setRecords] = useState<any[]>([]);
    const [orgs, setOrgs] = useState<any[]>([]);
    const [clients, setClients] = useState<any[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    
    // Batch Import Configuration States
    const [importConfigOpen, setImportConfigOpen] = useState(false);
    const [importTargetDeptId, setImportTargetDeptId] = useState('');
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchFilters, setSearchFilters] = useState({
        product_info: '', org_name: '', client_name: '', trade_location: '', invoice_status: '', transaction_status: '', trade_date_start: '', trade_date_end: '', department_id: ''
    });
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [tradeLinks, setTradeLinks] = useState<Record<string, number>>({});

    const [aggregatedStats, setAggregatedStats] = useState({ totalRevenue: 0, invoicedRevenue: 0, pendingCount: 0 });
    const [totalRecordsCount, setTotalRecordsCount] = useState(0);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [debouncedFilters, setDebouncedFilters] = useState(searchFilters);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        // Subject Entity: stores as "type:id" (e.g., "org:UUID" or "client:TAXID")
        subject_id: '', 
        // Client Entity: stores as "type:id"
        client_id: '',
        amount: 0, is_invoiced: true, has_cashflow: false,
        project_name: '', product_info: '', quantity: 1, unit_price: 0, notes: '',
        trade_date: new Date().toISOString().split('T')[0], trade_location: '',
        invoice_handler_dept_id: '', cashier_handler_dept_id: '', department_id: ''
    });

    // Helper to get entity name from unified pool
    const getEntityName = (compositeId: string) => {
        if (!compositeId) return '未指定';
        const [type, id] = compositeId.split(':');
        if (type === 'org') return orgs.find(o => o.id === id)?.name || '未知主体';
        if (type === 'client') return clients.find(c => c.tax_id === id)?.full_name || '未知客户';
        return '未知实体';
    };
    const [isImporting, setIsImporting] = useState(false);
    
    // Searchable Select States
    const [subjectSearch, setSubjectSearch] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [isSubjectSelectOpen, setIsSubjectSelectOpen] = useState(false);
    const [isClientSelectOpen, setIsClientSelectOpen] = useState(false);

    // Click outside handler for searchable selects
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest('.searchable-select-container')) {
                setIsSubjectSelectOpen(false);
                setIsClientSelectOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const handler = setTimeout(() => {
            if (JSON.stringify(debouncedFilters) !== JSON.stringify(searchFilters)) {
                setDebouncedFilters(searchFilters);
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [searchFilters]);

    useEffect(() => {
        setCurrentPage(1);
        fetchData(1, debouncedFilters, pageSize);
    }, [debouncedFilters, pageSize]);

    useEffect(() => {
        if (currentPage !== 1) fetchData(currentPage, debouncedFilters, pageSize);
    }, [currentPage]);

    const fetchData = async (page = currentPage, filters = debouncedFilters, limit = pageSize) => {
        let matchedClientTaxIds: string[] | null = null;
        
        if (filters.client_name) {
            const { data: matchedClients } = await supabase
                .from('global_clients')
                .select('tax_id')
                .ilike('full_name', `%${filters.client_name}%`);
            
            matchedClientTaxIds = matchedClients?.map(c => c.tax_id) || [];
            if (matchedClientTaxIds.length === 0) {
               setRecords([]);
               setTotalRecordsCount(0);
               setAggregatedStats({ totalRevenue: 0, invoicedRevenue: 0, pendingCount: 0 });
               return;
            }
        }
        
        // Fix: Explicitly specify the FK relation to resolve ambiguity since we now have multiple FKs to organizations
        let query = supabase.from('invoices').select('*, organizations!invoices_org_id_fkey(name)', { count: 'exact' });
        
        if (permissionLevel === 'head' || permissionLevel === 'edit') {
            if (currentUser?.department_id) {
                query = query.or(`department_id.eq.${currentUser.department_id},invoice_handler_dept_id.eq.${currentUser.department_id},cashier_handler_dept_id.eq.${currentUser.department_id}`);
            } else if (currentUser?.id) {
                query = query.eq('created_by', currentUser.id);
            }
        }

        if (filters.product_info) query = query.ilike('product_info', `%${filters.product_info}%`);
        if (filters.org_name) query = query.ilike('organizations.name', `%${filters.org_name}%`);
        if (matchedClientTaxIds) query = query.in('client_tax_id', matchedClientTaxIds);
        if (filters.trade_location) query = query.ilike('trade_location', `%${filters.trade_location}%`);
        if (filters.invoice_status) query = query.eq('invoice_status', filters.invoice_status);
        if (filters.transaction_status) query = query.eq('transaction_status', filters.transaction_status);
        if (filters.trade_date_start) query = query.gte('trade_date', filters.trade_date_start);
        if (filters.trade_date_end) query = query.lte('trade_date', filters.trade_date_end);
        if (filters.department_id) query = query.eq('department_id', filters.department_id);

        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to).order('trade_date', { ascending: false });

        const { data: r, count, error } = await query;
        if (error) {
            console.error("Data Fetch Error:", error);
            setFetchError(`获取数据失败: ${error.message}${error.hint ? ' (' + error.hint + ')' : ''}`);
            setRecords([]);
        } else {
            setFetchError(null);
            setRecords(r || []);
            setTotalRecordsCount(count || 0);
        }

        const { data: o } = await supabase.from('organizations').select('*');
        const { data: c } = await supabase.from('global_clients').select('*');
        const { data: d } = await supabase.from('departments').select('id, name');
        if (o) setOrgs(o);
        if (c) setClients(c);
        if (d) setAllDepartments(d);

        try {
            const { data: stats, error: rpcError } = await supabase.rpc('get_invoice_stats', {
                p_dept_id: (permissionLevel === 'head' || permissionLevel === 'edit') ? (currentUser?.department_id || null) : null,
                p_user_id: (permissionLevel === 'head' || permissionLevel === 'edit') && !currentUser?.department_id ? (currentUser?.id || null) : null,
                p_product: filters.product_info || null,
                p_org_name: filters.org_name || null,
                p_client_tax_ids: matchedClientTaxIds,
                p_location: filters.trade_location || null,
                p_invoice_status: filters.invoice_status || null,
                p_transaction_status: filters.transaction_status || null,
                p_start_date: filters.trade_date_start || null,
                p_end_date: filters.trade_date_end || null
            });
            
            if (rpcError) throw rpcError;

            if (stats && stats.length > 0) {
                setAggregatedStats({
                    totalRevenue: stats[0].total_revenue || 0,
                    invoicedRevenue: stats[0].invoiced_revenue || 0,
                    pendingCount: stats[0].pending_count || 0
                });
            }
        } catch (e: any) {
            console.error("RPC Error (Requires SQL execution):", e);
            if (r) {
                setAggregatedStats({
                    totalRevenue: r.reduce((sum:any, item:any) => sum + Number(item.amount), 0),
                    invoicedRevenue: r.filter((item:any) => item.invoice_status === 'invoiced').reduce((sum:any, item:any) => sum + Number(item.amount), 0),
                    pendingCount: r.filter((item:any) => item.invoice_status === 'pending' || item.transaction_status === 'pending').length
                });
            }
        }
        if (r) {
            const tradeIds = r.map((item: any) => item.id);
            if (tradeIds.length > 0) {
                const { data: linkTotals } = await supabase
                    .from('tax_invoice_trade_links')
                    .select('trade_id, allocated_amount')
                    .in('trade_id', tradeIds);
                
                const totals: Record<string, number> = {};
                linkTotals?.forEach(lt => {
                    totals[lt.trade_id] = (totals[lt.trade_id] || 0) + Number(lt.allocated_amount);
                });
                setTradeLinks(totals);
            }
        }
    };

    // Helper to map record into Subject/Client display (handles flexible roles)
    const getRecordEntities = (record: any) => {
        let subject = { name: '未指定', type: '' };
        let client = { name: '未定客户', type: '' };

        // 1. Determine Subject (Prioritize Subject overrides if they exist in schema)
        if (record.subject_client_tax_id) {
            const c = clients.find(cl => cl.tax_id === record.subject_client_tax_id);
            subject = { name: c?.full_name || record.subject_client_tax_id, type: 'client' };
        } else if (record.org_id) {
            subject = { name: record.organizations?.name || '主体缺失', type: 'org' };
        }

        // 2. Determine Client
        if (record.client_org_id) {
            const o = orgs.find(org => org.id === record.client_org_id);
            client = { name: o?.name || '内部伙伴', type: 'org' };
        } else if (record.client_tax_id) {
            const c = clients.find(cl => cl.tax_id === record.client_tax_id);
            client = { name: c?.full_name || record.client_tax_id, type: 'client' };
        }

        return { subject, client };
    };

    // 更新状态的逻辑 (新版: 分开票和流水)
    const updateInvoiceStatus = async (id: string, nextStatus: string) => {
        const updatePayload: any = { invoice_status: nextStatus };
        if (nextStatus === 'invoiced') {
            updatePayload.invoice_completed_date = new Date().toISOString();
        }
        await supabase.from('invoices').update(updatePayload).eq('id', id);
        alert('已确认开票状态并通知财务等相关部门');
        fetchData();
    };

    const updateTransactionStatus = async (id: string, nextStatus: string) => {
        const updatePayload: any = { transaction_status: nextStatus };
        if (nextStatus === 'completed') {
            updatePayload.transaction_completed_date = new Date().toISOString();
        }
        await supabase.from('invoices').update(updatePayload).eq('id', id);
        alert('已确认流水完成并通知各相关部门');
        fetchData();
    };

    const startEdit = (record: any) => {
        setEditingId(record.id);
        
        let subject_id = '';
        if (record.subject_client_tax_id) subject_id = `client:${record.subject_client_tax_id}`;
        else if (record.org_id) subject_id = `org:${record.org_id}`;

        let client_id = '';
        if (record.client_org_id) client_id = `org:${record.client_org_id}`;
        else if (record.client_tax_id) client_id = `client:${record.client_tax_id}`;

        setFormData({
            subject_id,
            client_id,
            amount: record.amount || 0,
            is_invoiced: record.invoice_status === 'invoiced',
            has_cashflow: record.transaction_status === 'completed',
            project_name: record.project_name || '',
            product_info: record.product_info || '',
            quantity: record.quantity || 1,
            unit_price: record.unit_price || 0,
            notes: record.notes || '',
            trade_date: record.trade_date || new Date().toISOString().split('T')[0],
            trade_location: record.trade_location || '',
            invoice_handler_dept_id: record.invoice_handler_dept_id || '',
            cashier_handler_dept_id: record.cashier_handler_dept_id || '',
            department_id: record.department_id || ''
        });

        // Initialize searches with current values
        setSubjectSearch(getEntityName(subject_id));
        setClientSearch(getEntityName(client_id));
        
        setIsModalOpen(true);
    };

    const startAdd = () => {
        setEditingId(null);
        setFormData({ subject_id: '', client_id: '', amount: 0, is_invoiced: true, has_cashflow: false, project_name: '', product_info: '', quantity: 1, unit_price: 0, notes: '', trade_date: new Date().toISOString().split('T')[0], trade_location: '', invoice_handler_dept_id: '', cashier_handler_dept_id: '', department_id: currentUser?.department_id || '' });
        setSubjectSearch('');
        setClientSearch('');
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({ subject_id: '', client_id: '', amount: 0, is_invoiced: true, has_cashflow: false, project_name: '', product_info: '', quantity: 1, unit_price: 0, notes: '', trade_date: new Date().toISOString().split('T')[0], trade_location: '', invoice_handler_dept_id: '', cashier_handler_dept_id: '', department_id: currentUser?.department_id || '' });
        setSubjectSearch('');
        setClientSearch('');
        setIsModalOpen(false);
    };

    // 选中当前页全部
    const handleSelectCurrentPage = () => {
        const newSet = new Set(selectedIds);
        records.forEach(r => newSet.add(r.id));
        setSelectedIds(newSet);
    };

    // 反选当前页
    const handleDeselectCurrentPage = () => {
        const newSet = new Set(selectedIds);
        records.forEach(r => newSet.delete(r.id));
        setSelectedIds(newSet);
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (window.confirm(`🧨 危险操作：确定要彻底删除选中的 ${selectedIds.size} 条业务记录吗？\n删除后数据不可恢复！`)) {
            try {
                const idsToDelete = Array.from(selectedIds);
                const chunkSize = 100;
                for (let i = 0; i < idsToDelete.length; i += chunkSize) {
                    const chunk = idsToDelete.slice(i, i + chunkSize);
                    const { error } = await supabase.from('invoices').delete().in('id', chunk);
                    if (error) throw error;
                }
                alert(`✅ 成功清洗 ${idsToDelete.length} 条业务数据！`);
                setSelectedIds(new Set());
                fetchData();
            } catch (err: any) {
                alert('批量删除部分失败: ' + err.message);
            }
        }
    };

    // 导出数据（支持当前页或全部已选）
    const handleExport = (scope: 'page' | 'selected') => {
        const dataToExport = scope === 'page' ? records : records.filter(r => selectedIds.has(r.id));
        const exportData = dataToExport.map(r => {
            const { subject, client } = getRecordEntities(r);
            return {
                '项目名称': r.project_name,
                '业务归属部门': allDepartments.find(d => d.id === r.department_id)?.name || '',
                '交易主体': subject.name,
                '主体类型': subject.type === 'org' ? '集团' : '客商',
                '客户名称': client.name,
                '客户类型': client.type === 'org' ? '集团' : '客商',
                '商品信息': r.product_info,
                '发生日期': r.trade_date,
                '交易地点': r.trade_location,
                '交易金额': r.amount,
                '数量': r.quantity,
                '单价': r.unit_price,
                '发票状态': r.invoice_status === 'invoiced' ? '已开票' : '待开票',
                '开票完成日期': r.invoice_completed_date || '',
                '资金流水状态': r.transaction_status === 'completed' ? '已结清' : '待确认',
                '流水完成日期': r.transaction_completed_date || '',
                '已核销金额': tradeLinks[r.id] || 0,
                '核销率': `${Math.min(100, Math.round(((tradeLinks[r.id] || 0) / (r.amount || 1)) * 100))}%`,
                '业务归属部门ID': r.department_id,
                '备注': r.notes,
                '创建时间': r.created_at
            };
        });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '业务记录');
        const label = scope === 'page' ? '当前页' : '已选';
        XLSX.writeFile(wb, `海露业务贸易记录_${label}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const isAllPageSelected = records.length > 0 && records.every(r => selectedIds.has(r.id));

    const handleDelete = async (id: string, projectName: string) => {
        if (window.confirm(`确认删除此涉猎项目 [${projectName || '无名称业务'}] 的所有业务数据吗？`)) {
            const { error } = await supabase.from('invoices').delete().eq('id', id);
            if (error) alert(`删除失败: ${error.message}`);
            else fetchData();
        }
    };

    const addRecord = async () => {
        const calculatedAmount = formData.quantity * formData.unit_price;
        
        const [subType, subVal] = formData.subject_id.split(':');
        const [cliType, cliVal] = formData.client_id.split(':');

        const submitData: any = {
            ...formData,
            org_id: subType === 'org' ? subVal : null,
            subject_client_tax_id: subType === 'client' ? subVal : null,
            client_tax_id: cliType === 'client' ? cliVal : null,
            client_org_id: cliType === 'org' ? cliVal : null,
            amount: calculatedAmount,
            invoice_status: formData.is_invoiced ? 'invoiced' : 'pending',
            transaction_status: formData.has_cashflow ? 'completed' : 'pending',
            created_by: currentUser?.id || null,
            department_id: formData.department_id || currentUser?.department_id || null,
            invoice_handler_dept_id: allDepartments.find(d => d.name === '计划中心')?.id || null,
            cashier_handler_dept_id: allDepartments.find(d => d.name === '资管中心')?.id || null
        };
        
        delete (submitData as any).has_cashflow;
        delete (submitData as any).is_invoiced;
        delete (submitData as any).subject_id;
        delete (submitData as any).client_id;

        if (!editingId) {
            submitData.invoice_no = `TR_${Date.now()}`;
        }
        
        if (formData.is_invoiced) submitData.invoice_completed_date = new Date().toISOString();
        if (formData.has_cashflow) submitData.transaction_completed_date = new Date().toISOString();

        if (editingId) {
            const { error } = await supabase.from('invoices').update(submitData).eq('id', editingId);
            if (error) alert(`更新失败: ${error.message}\n(如果是字段缺失错误, 请联系管理员添加 subject_client_tax_id 和 client_org_id 字段)`);
            else { alert('业务记录已更新'); resetForm(); fetchData(); }
        } else {
            const { error } = await supabase.from('invoices').insert([submitData]);
            if (error) alert(`录入失败: ${error.message}\n(如果是字段缺失错误, 请联系管理员添加 subject_client_tax_id 和 client_org_id 字段)`);
            else { alert('贸易记录已入库'); resetForm(); fetchData(); }
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
            const jsonData: any[] = XLSX.utils.sheet_to_json(sheet);

            if (jsonData.length === 0) {
                alert('表格为空或格式不正确');
                return;
            }

            const fieldMapping: Record<string, string> = {
                '所属项目': 'project_name',
                '商品信息': 'product_info',
                '数量': 'quantity',
                '单价': 'unit_price',
                '发生日期': 'trade_date',
                '地点': 'trade_location',
                '备注': 'notes'
            };

            const recordsToInsert = jsonData.map((row, index) => {
                const newRecord: any = { 
                    invoice_status: 'pending',
                    transaction_status: 'pending',
                    amount: 0,
                    invoice_no: `批量_TR_${Date.now()}_${index}`,
                    created_by: currentUser?.id || null,
                    department_id: importTargetDeptId || currentUser?.department_id || null,
                    invoice_handler_dept_id: allDepartments.find((d: any) => d.name === '计划中心')?.id || null,
                    cashier_handler_dept_id: allDepartments.find((d: any) => d.name === '资管中心')?.id || null
                };
                
                Object.keys(row).forEach(key => {
                    const englishKey = fieldMapping[key.trim()];
                    if (englishKey) {
                        let val = row[key];
                        if (englishKey === 'quantity' || englishKey === 'unit_price') {
                            newRecord[englishKey] = parseFloat(String(val)) || 0;
                        } else if (englishKey === 'trade_date') {
                            if (typeof val === 'number') {
                                newRecord.trade_date = new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0];
                            } else {
                                newRecord.trade_date = String(val).trim();
                            }
                        } else {
                            newRecord[englishKey] = String(val).trim();
                        }
                    }
                });

                // Handle boolean explicitly mapping
                const invoicedRaw = row['是否开票'];
                if (invoicedRaw) {
                    const isInv = (invoicedRaw === '是' || invoicedRaw === true || invoicedRaw === 'TRUE');
                    newRecord.invoice_status = isInv ? 'invoiced' : 'pending';
                    if (isInv) newRecord.invoice_completed_date = new Date().toISOString();
                }

                const cashflowRaw = row['已走流水'];
                if (cashflowRaw) {
                    const isFlow = (cashflowRaw === '是' || cashflowRaw === true || cashflowRaw === 'TRUE');
                    newRecord.transaction_status = isFlow ? 'completed' : 'pending';
                    if (isFlow) newRecord.transaction_completed_date = new Date().toISOString();
                }

                // Handle Subject Detection
                let detectedSubjectName = '';
                const subjectKey = Object.keys(row).find(k => k.trim() === '主体公司');
                if (subjectKey) detectedSubjectName = String(row[subjectKey]).trim();
                
                if (detectedSubjectName) {
                    const matchedOrg = orgs.find(o => o.name === detectedSubjectName || o.short_name === detectedSubjectName);
                    if (matchedOrg) newRecord.org_id = matchedOrg.id;
                    else {
                        const matchedCli = clients.find(c => c.full_name === detectedSubjectName || c.short_name === detectedSubjectName);
                        if (matchedCli) newRecord.subject_client_tax_id = matchedCli.tax_id;
                    }
                }

                // Handle Client Detection
                let detectedClientName = '';
                const clientKey = Object.keys(row).find(k => k.trim() === '往来客户');
                if (clientKey) detectedClientName = String(row[clientKey]).trim();

                if (detectedClientName) {
                    const matchedCli = clients.find(c => c.tax_id === String(detectedClientName) || c.full_name === detectedClientName || c.short_name === detectedClientName);
                    if (matchedCli) newRecord.client_tax_id = matchedCli.tax_id;
                    else {
                        const matchedOrg = orgs.find(o => o.name === detectedClientName || o.short_name === detectedClientName);
                        if (matchedOrg) newRecord.client_org_id = matchedOrg.id;
                    }
                }

                // Calculate amount
                newRecord.amount = (newRecord.quantity || 0) * (newRecord.unit_price || 0);

                return newRecord;
            });

            if (recordsToInsert.length === 0) {
                alert('没有找到合规的数据');
                return;
            }

            const { error } = await supabase.from('invoices').insert(recordsToInsert);
            if (error) {
                alert(`批量导入失败: ${error.message}`);
            } else {
                alert(`成功导入 ${recordsToInsert.length} 条业务记录!`);
                fetchData();
            }
        } catch (error: any) {
            alert(`读取文件失败: ${error.message}`);
        } finally {
            setIsImporting(false);
            setImportConfigOpen(false); // Close routing popup
            if (e.target) e.target.value = ''; // reset file input
        }
    };


    const totalPages = Math.ceil(totalRecordsCount / pageSize);

    return (
        <div className="p-8 max-w-[1600px] mx-auto print:p-0">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 print:hidden">
                <h2 className="text-2xl font-black text-slate-800">业务贸易数据</h2>
                <div className="flex gap-2 w-full md:w-auto flex-wrap justify-end">
                    {canEdit && (
                    <button onClick={startAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center transition-all shadow-lg shadow-indigo-600/20">
                        ➕ 单笔录入
                    </button>
                    )}
                    {canEdit && (
                        <div className="relative">
                            <button onClick={() => setImportConfigOpen(!importConfigOpen)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center transition-colors shadow-lg shadow-emerald-600/20">
                                📥 跨部门协同批量导入
                            </button>
                            {importConfigOpen && (
                                <div className="absolute top-12 right-0 w-80 bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 z-40 print:hidden text-left flex flex-col gap-3 object-left-top">
                                    <div className="flex justify-between items-center mb-1">
                                        <h4 className="text-sm font-black text-slate-800">批量导入流转配置</h4>
                                        <button onClick={() => setImportConfigOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">请选择该批次数据的路由方向。您可以将这批数据的一键派发给财务或出纳部门进行待办。</p>
                                    
                                    {!currentUser?.department_id && (
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 mb-1">1. 指定业务归属部门 (总经办必填)</label>
                                            <select className="w-full text-xs border p-2 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" value={importTargetDeptId} onChange={e => setImportTargetDeptId(e.target.value)}>
                                                <option value="">-- 选择业务归属中心 --</option>
                                                {allDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    
                                    <div className="bg-slate-50 border border-slate-100 p-2 rounded-lg mt-2">
                                        <p className="text-[10px] text-slate-500 mb-1"><span className="text-emerald-600 font-bold">✔️ 自动流转开票节点: </span>计划中心</p>
                                        <p className="text-[10px] text-slate-500"><span className="text-emerald-600 font-bold">✔️ 自动流转流水节点: </span>资管中心</p>
                                    </div>

                                    <label className={`mt-2 cursor-pointer ${isImporting || (!currentUser?.department_id && !importTargetDeptId) ? 'bg-slate-300 pointer-events-none' : 'bg-emerald-600 hover:bg-emerald-700'} text-white w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center transition-colors shadow-md`}>
                                        {isImporting ? '处理并流转中...' : (!currentUser?.department_id && !importTargetDeptId ? '请先选择业务归属部门' : '✔️ 确认配置并上传Excel')}
                                        <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={isImporting || (!currentUser?.department_id && !importTargetDeptId)} />
                                    </label>
                                </div>
                            )}
                        </div>
                    )}
                    {canEdit && (
                        <div className="flex gap-2 items-center flex-wrap">
                            {selectedIds.size > 0 ? (
                                <>
                                    <button onClick={handleDeselectCurrentPage} className="bg-slate-100 text-slate-600 border border-slate-200 px-4 py-2.5 rounded-xl text-[12px] font-black hover:bg-slate-200 transition-colors flex items-center">
                                        🚫 清空已选
                                    </button>
                                    <button onClick={handleBatchDelete} className="bg-rose-50 text-rose-600 border border-rose-100 px-4 py-2.5 rounded-xl text-[12px] font-black hover:bg-rose-600 hover:text-white transition-colors flex items-center animate-bounce shadow-lg shadow-rose-100">
                                        🗑️ 删除已选 ({selectedIds.size})
                                    </button>
                                </>
                            ) : (
                                <button onClick={handleSelectCurrentPage} disabled={records.length === 0} className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-4 py-2.5 rounded-xl text-[12px] font-black hover:bg-indigo-600 hover:text-white transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                                    ☑️ 批量选中当前页
                                </button>
                            )}
                        </div>
                    )}
                    {/* 导出按钮 */}
                    <div className="relative group">
                        <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-2xl text-sm font-black transition-all shadow-lg shadow-blue-100 flex items-center gap-1.5">
                            📤 导出
                            <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                            <button onClick={() => handleExport('page')} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2">
                                <span className="text-blue-500">📄</span> 导出当前页
                                <span className="ml-auto text-[10px] text-slate-400 font-normal">({records.length})</span>
                            </button>
                            <button onClick={() => handleExport('selected')} disabled={selectedIds.size === 0} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2 border-t border-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                                <span className="text-emerald-500">📋</span> 导出已选
                                <span className="ml-auto text-[10px] text-slate-400 font-normal">({selectedIds.size})</span>
                            </button>
                        </div>
                    </div>
                    <button onClick={() => window.print()} className="bg-slate-100 px-4 py-2.5 rounded-xl hover:bg-slate-200 text-sm font-bold text-slate-600 transition-colors" title="打印记录">
                        🖨️ 打印报表
                    </button>
                </div>
            </div>

            {/* 顶部财务看板 (响应过滤) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-3xl shadow-xl text-white">
                    <p className="text-blue-100 text-xs font-bold uppercase tracking-widest">筛选口径·累计营业收入</p>
                    <p className="text-3xl font-black mt-2 tracking-tight">¥ {Number(aggregatedStats.totalRevenue).toLocaleString()}</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-6 rounded-3xl shadow-xl text-white">
                    <p className="text-emerald-100 text-xs font-bold uppercase tracking-widest">筛选口径·确定入账 (已开票)</p>
                    <p className="text-3xl font-black mt-2 tracking-tight">¥ {Number(aggregatedStats.invoicedRevenue).toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">执行中的待办节点</p>
                    <p className="text-3xl font-black mt-2 text-slate-800">
                        {aggregatedStats.pendingCount} <span className="text-sm font-bold text-slate-400">个任务瓶颈</span>
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* 多维检索侧边栏 */}
                <div className="lg:col-span-1 space-y-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:hidden">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                            <span className="w-2 h-4 bg-indigo-500 rounded-full"></span>
                            多维数据检索
                        </h3>
                        <button onClick={() => setSearchFilters({ product_info: '', org_name: '', client_name: '', trade_location: '', invoice_status: '', transaction_status: '', trade_date_start: '', trade_date_end: '', department_id: '' })} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded hover:bg-slate-200 transition-colors">
                            重置清空
                        </button>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">筛选归属部门</label>
                        <select className="w-full border p-2 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all" value={searchFilters.department_id} onChange={e => setSearchFilters({ ...searchFilters, department_id: e.target.value })}>
                            <option value="">全部部门</option>
                            {allDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </div>
                
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">商品信息检索</label>
                        <input className="w-full border p-2 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="模糊匹配" value={searchFilters.product_info} onChange={e => setSearchFilters({ ...searchFilters, product_info: e.target.value })} />
                    </div>
                    
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">主体公司搜索</label>
                        <input className="w-full border p-2 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="模糊匹配" value={searchFilters.org_name} onChange={e => setSearchFilters({ ...searchFilters, org_name: e.target.value })} />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">往来客户</label>
                        <input className="w-full border p-2 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="模糊匹配" value={searchFilters.client_name} onChange={e => setSearchFilters({ ...searchFilters, client_name: e.target.value })} />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">发生地点</label>
                        <input className="w-full border p-2 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all" placeholder="例如：广州" value={searchFilters.trade_location} onChange={e => setSearchFilters({ ...searchFilters, trade_location: e.target.value })} />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 mb-1">财务开票状态</label>
                            <select className="w-full border p-2 rounded-lg text-xs bg-slate-50 focus:bg-white outline-none" value={searchFilters.invoice_status} onChange={e => setSearchFilters({ ...searchFilters, invoice_status: e.target.value })}>
                                <option value="">全部</option>
                                <option value="invoiced">已开票</option>
                                <option value="pending">待开票</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 mb-1">资金流水状态</label>
                            <select className="w-full border p-2 rounded-lg text-xs bg-slate-50 focus:bg-white outline-none" value={searchFilters.transaction_status} onChange={e => setSearchFilters({ ...searchFilters, transaction_status: e.target.value })}>
                                <option value="">全部</option>
                                <option value="completed">已走完</option>
                                <option value="pending">待确认</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">发生日期区间</label>
                        <div className="flex flex-col gap-2">
                            <input type="date" className="w-full border p-2 rounded-lg text-xs text-slate-500 bg-slate-50 outline-none" value={searchFilters.trade_date_start} onChange={e => setSearchFilters({ ...searchFilters, trade_date_start: e.target.value })} title="开始日期" />
                            <input type="date" className="w-full border p-2 rounded-lg text-xs text-slate-500 bg-slate-50 outline-none" value={searchFilters.trade_date_end} onChange={e => setSearchFilters({ ...searchFilters, trade_date_end: e.target.value })} title="结束日期" />
                        </div>
                    </div>
                </div>

                {/* 穿透看板：响应过滤排序数组 */}
                <div className="lg:col-span-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto min-h-[500px]">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-slate-400 text-xs font-bold uppercase border-b">
                                <th className="pb-4 w-10">
                                    <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={isAllPageSelected} onChange={e => {
                                        const newSet = new Set(selectedIds);
                                        if (e.target.checked) records.forEach(r => newSet.add(r.id));
                                        else records.forEach(r => newSet.delete(r.id));
                                        setSelectedIds(newSet);
                                    }} />
                                </th>
                                <th className="pb-4">贸易项目归属</th>
                                <th className="pb-4">交易主体与商品</th>
                                <th className="pb-4">交易金额</th>
                                <th className="pb-4">开票进度</th>
                                <th className="pb-4 text-right pr-4">业务流程进度</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                             {records.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-20 bg-slate-50 rounded-2xl">
                                        {fetchError ? (
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="text-rose-500 font-black text-lg">⚠️ 数据加载故障</div>
                                                <div className="text-slate-500 text-sm max-w-md">{fetchError}</div>
                                                <button onClick={() => fetchData()} className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-200 hover:scale-105 transition-transform">重新尝试加载</button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-2">
                                                <div className="text-slate-400 font-bold text-lg">目前暂无符合条件的贸易记录</div>
                                                <button onClick={() => setSearchFilters({ product_info: '', org_name: '', client_name: '', trade_location: '', invoice_status: '', transaction_status: '', trade_date_start: '', trade_date_end: '', department_id: '' })} className="text-indigo-600 text-sm font-bold hover:underline">清空所有筛选条件</button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ) : records.map(r => (
                                <tr key={r.id} className={`group hover:bg-slate-50 ${selectedIds.has(r.id) ? 'bg-blue-50/50' : ''}`}>
                                    <td className="py-4 align-top">
                                        <input type="checkbox" className="w-4 h-4 rounded-md border-slate-200 text-indigo-600 focus:ring-indigo-500 cursor-pointer" checked={selectedIds.has(r.id)} onChange={() => {
                                            const newSet = new Set(selectedIds);
                                            if (newSet.has(r.id)) newSet.delete(r.id);
                                            else newSet.add(r.id);
                                            setSelectedIds(newSet);
                                        }} />
                                    </td>
                                    <td className="py-4 align-top">
                                        <div className="flex flex-col gap-1.5 pt-1">
                                            <div className="text-sm font-black text-slate-800 break-words max-w-[180px] leading-tight filter drop-shadow-sm">
                                                {r.project_name || '未命名项目'}
                                            </div>
                                            <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded shadow-sm w-max font-bold mt-1">
                                                🏭 {allDepartments.find(d => d.id === r.department_id)?.name || '未划归部门'}
                                            </div>
                                            {(r.trade_date || r.trade_location) && (
                                                <div className="text-[10px] text-slate-400 mt-1 flex flex-col gap-1">
                                                    {r.trade_date && <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 w-max">📅 {r.trade_date}</span>}
                                                    {r.trade_location && <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 w-max">📍 {r.trade_location}</span>}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 align-top">
                                        <div className="flex flex-col gap-1 rounded-xl p-2 bg-slate-50 border border-slate-100/50 group-hover:bg-white transition-colors relative">
                                            {(() => {
                                                const { subject, client } = getRecordEntities(r);
                                                return (
                                                    <div className="flex flex-col gap-1 mb-1">
                                                        <div className={`text-[11px] font-black leading-tight flex items-center gap-1.5 ${subject.type === 'org' ? 'text-indigo-700' : 'text-amber-700'}`}>
                                                            {subject.type === 'org' ? '🏢 [集团] ' : '👥 [客商] '} 主体: {subject.name}
                                                        </div>
                                                        
                                                        <div className={`text-[11px] font-bold border-l-2 pl-1.5 mt-0.5 flex items-center gap-1.5 ${client.type === 'org' ? 'text-indigo-600 border-indigo-200' : 'text-slate-600 border-slate-200'}`}>
                                                            {client.type === 'org' ? '🏢 [集团] ' : '🤝 '} 客户: {client.name}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            
                                            <div className="text-[10px] text-slate-500 mt-1 mb-1 leading-relaxed bg-white border border-slate-100 p-1.5 rounded-lg shadow-sm">
                                                📦 <span className="font-semibold text-slate-600">商品与物料:</span> {r.product_info || '---'}
                                            </div>
                                            
                                            {r.notes && <div className="text-[10px] text-amber-600/90 mt-0.5 px-1 py-0.5 w-full flex items-start gap-1 bg-amber-50/50 rounded filter drop-shadow-sm">📝 备注: {r.notes}</div>}
                                            
                                            {canEdit && (
                                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEdit(r)} className="text-[10px] text-blue-600 bg-blue-50/80 px-2 py-1 rounded shadow-sm hover:bg-blue-600 hover:text-white transition-colors">编辑</button>
                                                <button onClick={() => handleDelete(r.id, r.project_name)} className="text-[10px] text-rose-600 bg-rose-50/80 px-2 py-1 rounded shadow-sm hover:bg-rose-600 hover:text-white transition-colors">删除</button>
                                            </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 align-top">
                                        <div className="flex flex-col gap-0.5">
                                            <div className="font-black text-slate-800 text-sm">¥{(r.amount || 0).toLocaleString()}</div>
                                            <div className="text-[10px] text-slate-500 font-medium">数量: {(r.quantity || 0).toLocaleString()} <span className="text-slate-300 mx-0.5">|</span> 单价: ¥{(r.unit_price || 0).toLocaleString()}</div>
                                        </div>
                                    </td>
                                    <td className="py-4 align-top">
                                        <div className="w-24 mt-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-[9px] font-black text-slate-400">核销率</span>
                                                <span className="text-[9px] font-black text-indigo-600">{Math.min(100, Math.round(((tradeLinks[r.id] || 0) / (r.amount || 1)) * 100))}%</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                                <div 
                                                    className={`h-full transition-all duration-500 ${Math.round(((tradeLinks[r.id] || 0) / (r.amount || 1)) * 100) >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
                                                    style={{ width: `${Math.min(100, ((tradeLinks[r.id] || 0) / (r.amount || 1)) * 100)}%` }}
                                                />
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-1 font-mono">¥{(tradeLinks[r.id] || 0).toLocaleString()} / {r.amount.toLocaleString()}</div>
                                        </div>
                                    </td>
                                    <td className="py-4 align-top">
                                        <div className="flex flex-col gap-2 items-end pr-4">
                                            {r.invoice_status === 'invoiced' ? (
                                                <div className="text-[10px] flex flex-col items-end gap-0.5">
                                                    <span className="bg-blue-50 text-blue-600 border border-blue-100 px-2 flex items-center h-5 rounded-full font-bold shadow-sm">✔️ 发票已开</span>
                                                    {r.invoice_completed_date && <span className="text-[9px] text-slate-400 pr-1">{new Date(r.invoice_completed_date).toLocaleDateString()}</span>}
                                                </div>
                                            ) : (
                                                canEdit ? (
                                                    <button onClick={() => updateInvoiceStatus(r.id, 'invoiced')} className="text-[10px] border border-blue-500 text-blue-600 px-3 h-6 rounded-full hover:bg-blue-600 hover:text-white transition-all shadow-sm font-bold bg-white focus:outline-none">确认开票完成</button>
                                                ) : (
                                                    <span className="bg-slate-50 text-slate-500 border border-slate-100 px-2 flex items-center h-5 rounded-full font-bold text-[10px]">待开票审核</span>
                                                )
                                            )}
                                            
                                            {r.transaction_status === 'completed' ? (
                                                <div className="text-[10px] flex flex-col items-end gap-0.5">
                                                    <span className="bg-purple-50 text-purple-600 border border-purple-100 px-2 flex items-center h-5 rounded-full font-bold shadow-sm">✔️ 流水已结清</span>
                                                    {r.transaction_completed_date && <span className="text-[9px] text-slate-400 pr-1">{new Date(r.transaction_completed_date).toLocaleDateString()}</span>}
                                                </div>
                                            ) : (
                                                canEdit ? (
                                                    <button onClick={() => updateTransactionStatus(r.id, 'completed')} className="text-[10px] border border-purple-500 text-purple-600 px-3 h-6 rounded-full hover:bg-purple-600 hover:text-white transition-all shadow-sm font-bold bg-white focus:outline-none">确认流水结清</button>
                                                ) : (
                                                    <span className="bg-slate-50 text-slate-500 border border-slate-100 px-2 flex items-center h-5 rounded-full font-bold text-[10px]">待业务流水</span>
                                                )
                                            )}
                                            
                                            {r.invoice_status === 'invoiced' && r.transaction_status === 'completed' && (
                                                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded shadow-sm border border-emerald-100 mt-1">
                                                    ✅ 业务全满结案
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* 分页控制 */}
                    {totalRecordsCount > 0 && (
                        <div className="flex flex-col md:flex-row justify-between items-center mt-6 pt-4 border-t border-slate-100 gap-4">
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-slate-500 font-bold">每页显示：</span>
                                <select className="border border-slate-200 rounded-lg p-1.5 text-sm outline-none font-bold text-slate-700 bg-slate-50" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                                    <option value={10}>10</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={500}>500</option>
                                </select>
                                <span className="text-sm text-slate-500 ml-2">总计符合 <b className="text-slate-900 border-b-2 border-slate-900 px-1">{totalRecordsCount}</b> 条记录</span>
                            </div>
                            
                            <div className="flex gap-2 items-center">
                                <button disabled={currentPage === 1} onClick={() => setCurrentPage(c => c - 1)} className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-600 font-bold hover:bg-indigo-600 hover:text-white disabled:opacity-40 disabled:hover:bg-indigo-50 disabled:hover:text-indigo-600 transition-colors">
                                    ‹ 上一页
                                </button>
                                <span className="text-sm font-black text-slate-600 px-4 bg-slate-50 rounded-lg py-2">
                                    {currentPage} / {totalPages || 1}
                                </span>
                                <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(c => c + 1)} className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-600 font-bold hover:bg-indigo-600 hover:text-white disabled:opacity-40 disabled:hover:bg-indigo-50 disabled:hover:text-indigo-600 transition-colors">
                                    下一页 ›
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal Overlay对于表单录入 */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden">
                    <div className="bg-white p-6 rounded-[2rem] w-full max-w-xl shadow-2xl relative max-h-[90vh] overflow-y-auto">
                        <button onClick={resetForm} className="absolute top-6 right-6 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center font-bold transition-colors">✕</button>
                        <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3">
                            <span className={`w-3 h-8 ${editingId ? 'bg-amber-500' : 'bg-indigo-600'} rounded-full`}></span>
                            {editingId ? '修改业务记录' : '录入新业务数据'}
                        </h3>
                        
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <input className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="所属项目名称" value={formData.project_name} onChange={e => setFormData({ ...formData, project_name: e.target.value })} />
                                <select className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-emerald-800 bg-emerald-50/50" value={formData.department_id} onChange={e => setFormData({ ...formData, department_id: e.target.value })}>
                                    <option value="">==== 分配业务归属部门 ====</option>
                                    {allDepartments.map(d => <option key={d.id} value={d.id}>🏭 {d.name}</option>)}
                                </select>
                            </div>
                            
                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                                {/* Searchable Subject Select */}
                                <div className="space-y-1 relative searchable-select-container">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight ml-1">贸易发起主体 (甲方 / 卖方)</label>
                                    <div className="relative">
                                        <input 
                                            className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all bg-white font-bold"
                                            placeholder="输入关键字搜索主体公司..."
                                            value={subjectSearch}
                                            onChange={(e) => {
                                                setSubjectSearch(e.target.value);
                                                setIsSubjectSelectOpen(true);
                                            }}
                                            onFocus={() => setIsSubjectSelectOpen(true)}
                                        />
                                        {isSubjectSelectOpen && (
                                            <div className="absolute top-14 left-0 w-full bg-white border border-slate-200 shadow-2xl rounded-2xl z-50 max-h-60 overflow-y-auto p-2 scrollbar-thin animate-in fade-in slide-in-from-top-2 duration-200">
                                                {[...orgs.map(o => ({ ...o, type: 'org', label: `[主体] ${o.name}`, val: `org:${o.id}` })), ...clients.map(c => ({ ...c, type: 'client', label: `[客商] ${c.full_name}`, val: `client:${c.tax_id}` }))]
                                                    .filter(item => item.label.toLowerCase().includes(subjectSearch.toLowerCase()))
                                                    .map(item => (
                                                        <div 
                                                            key={item.val} 
                                                            onClick={() => {
                                                                setFormData({ ...formData, subject_id: item.val });
                                                                setSubjectSearch(item.label.replace(/\[.*?\]\s*/, ''));
                                                                setIsSubjectSelectOpen(false);
                                                            }}
                                                            className="p-3 text-sm hover:bg-slate-50 rounded-lg cursor-pointer flex items-center justify-between group transition-colors"
                                                        >
                                                            <span className="font-bold text-slate-700">{item.label}</span>
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${item.type === 'org' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                                                                {item.type === 'org' ? '内部' : '外部'}
                                                            </span>
                                                        </div>
                                                    ))
                                                }
                                                {subjectSearch && [...orgs, ...clients].filter(item => (item.name || item.full_name || '').toLowerCase().includes(subjectSearch.toLowerCase())).length === 0 && (
                                                    <div className="p-4 text-center text-xs text-slate-400 font-bold italic">未找到匹配的主体</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Searchable Client Select */}
                                <div className="space-y-1 relative searchable-select-container">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight ml-1">业务往来对手 (乙方 / 买方)</label>
                                    <div className="relative">
                                        <input 
                                            className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all bg-white font-bold"
                                            placeholder="输入关键字搜索往来对手..."
                                            value={clientSearch}
                                            onChange={(e) => {
                                                setClientSearch(e.target.value);
                                                setIsClientSelectOpen(true);
                                            }}
                                            onFocus={() => setIsClientSelectOpen(true)}
                                        />
                                        {isClientSelectOpen && (
                                            <div className="absolute top-14 left-0 w-full bg-white border border-slate-200 shadow-2xl rounded-2xl z-50 max-h-60 overflow-y-auto p-2 scrollbar-thin animate-in fade-in slide-in-from-top-2 duration-200">
                                                {[...clients.map(c => ({ ...c, type: 'client', label: `[客户] ${c.full_name}`, val: `client:${c.tax_id}` })), ...orgs.map(o => ({ ...o, type: 'org', label: `[伙伴] ${o.name}`, val: `org:${o.id}` }))]
                                                    .filter(item => item.label.toLowerCase().includes(clientSearch.toLowerCase()))
                                                    .map(item => (
                                                        <div 
                                                            key={item.val} 
                                                            onClick={() => {
                                                                setFormData({ ...formData, client_id: item.val });
                                                                setClientSearch(item.label.replace(/\[.*?\]\s*/, ''));
                                                                setIsClientSelectOpen(false);
                                                            }}
                                                            className="p-3 text-sm hover:bg-slate-50 rounded-lg cursor-pointer flex items-center justify-between group transition-colors"
                                                        >
                                                            <span className="font-bold text-slate-700">{item.label}</span>
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${item.type === 'org' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                                                                {item.type === 'org' ? '内部' : '外部'}
                                                            </span>
                                                        </div>
                                                    ))
                                                }
                                                {clientSearch && [...clients, ...orgs].filter(item => (item.full_name || item.name || '').toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                                                    <div className="p-4 text-center text-xs text-slate-400 font-bold italic">未找到匹配的对手</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <input className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="商品信息描述" value={formData.product_info} onChange={e => setFormData({ ...formData, product_info: e.target.value })} />
                                
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 uppercase">交易数量</label>
                                        <input type="number" className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="数量" title="数量" value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 uppercase">交易单价 (¥)</label>
                                        <input type="number" className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="单价" title="单价" value={formData.unit_price} onChange={e => setFormData({ ...formData, unit_price: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 text-slate-700 font-black rounded-xl border border-slate-100 flex justify-between items-center">
                                <span className="text-sm">系统核算金额：</span>
                                <span className="text-2xl text-slate-900">¥ { (formData.quantity * formData.unit_price).toLocaleString() }</span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <label className="flex items-center gap-3 text-sm text-slate-700 font-bold cursor-pointer">
                                    <input type="checkbox" className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-600" checked={formData.is_invoiced} onChange={e => setFormData({ ...formData, is_invoiced: e.target.checked })} />
                                    财务是否已开票
                                </label>
                                <label className="flex items-center gap-3 text-sm text-slate-700 font-bold cursor-pointer">
                                    <input type="checkbox" className="w-5 h-5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-600" checked={formData.has_cashflow} onChange={e => setFormData({ ...formData, has_cashflow: e.target.checked })} />
                                    资金是否已走流水
                                </label>
                            </div>


                            
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] text-slate-400 font-bold mb-1 ml-1">发生日期</label>
                                    <input type="date" className="w-full border border-slate-200 p-3.5 rounded-xl text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" value={formData.trade_date} onChange={e => setFormData({ ...formData, trade_date: e.target.value })} title="发生日期" />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-400 font-bold mb-1 ml-1">业务地点 (可选)</label>
                                    <input className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="深圳、广州 等" value={formData.trade_location} onChange={e => setFormData({ ...formData, trade_location: e.target.value })} />
                                </div>
                            </div>

                            <textarea className="w-full border border-slate-200 p-3.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none" placeholder="补充此笔贸易的详细备注信息 (选填)..." value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={3}></textarea>

                            <div className="pt-4 pb-2">
                                <button onClick={addRecord} className={`w-full py-4 text-white font-black rounded-xl shadow-xl transition-all flex items-center justify-center gap-2 ${editingId ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'}`}>
                                    {editingId ? '💾 覆写更新记录' : '➕ 确认新增上链'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}