import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../api/supabase';
import * as XLSX from 'xlsx';

const CATEGORIES = ["蔬菜", "蛋类", "肉类", "禽类", "畜牧类", "鲜果", "其他"];

export default function ProductManager({ permissionLevel = 'edit' }: { permissionLevel?: string }) {
    const canEdit = permissionLevel === 'edit' || permissionLevel === 'admin';
    const [products, setProducts] = useState<any[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [importing, setImporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [formData, setFormData] = useState({
        name: '', sku_code: '', category: '蔬菜', origin: '', grade: '', 
        unit: '吨', description: '', image_url: '', standard_price: 0
    });

    const fetchProducts = async () => {
        const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
        if (data) setProducts(data);
    };

    useEffect(() => { fetchProducts(); }, []);

    const filteredProducts = products.filter(p => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (
            p.name?.toLowerCase().includes(q) ||
            p.sku_code?.toLowerCase().includes(q) ||
            p.category?.toLowerCase().includes(q) ||
            p.origin?.toLowerCase().includes(q)
        );
    });

    const handleSubmit = async () => {
        if (!formData.name) return alert('商品名称不能为空');
        
        const submitData = { ...formData };

        if (!submitData.sku_code) {
            const catMap: Record<string, string> = {
                "蔬菜": "CS", "蛋类": "DL", "肉类": "RL", 
                "禽类": "QL", "畜牧类": "XM", "鲜果": "XG", "其他": "QT"
            };
            const prefix = `HL-${catMap[submitData.category] || 'QT'}-`;
            const { data: existing } = await supabase
                .from('products')
                .select('sku_code')
                .ilike('sku_code', `${prefix}%`)
                .order('sku_code', { ascending: false })
                .limit(1);
            
            let nextNum = 1;
            if (existing && existing.length > 0 && existing[0].sku_code) {
                const match = existing[0].sku_code.match(/-(\d+)$/);
                if (match) nextNum = parseInt(match[1], 10) + 1;
            }
            submitData.sku_code = `${prefix}${String(nextNum).padStart(5, '0')}`;
        }
        
        if (editingId) {
            const { error } = await supabase.from('products').update(submitData).eq('id', editingId);
            if (error) alert('更新失败: ' + error.message);
            else { alert('更新成功'); resetForm(); fetchProducts(); }
        } else {
            const { error } = await supabase.from('products').insert([submitData]);
            if (error) alert('新增失败: ' + error.message);
            else { alert('新增成功'); resetForm(); fetchProducts(); }
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`确定要彻底删除商品 [${name}] 吗？\n注意：如果已有贸易记录使用了该商品，删除可能会导致旧数据失去商品关联！`)) {
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) alert('删除失败: ' + error.message);
            else fetchProducts();
        }
    };

    const startEdit = (p: any) => {
        setEditingId(p.id);
        setFormData({
            name: p.name || '', sku_code: p.sku_code || '', category: p.category || '蔬菜',
            origin: p.origin || '', grade: p.grade || '', unit: p.unit || '吨',
            description: p.description || '', image_url: p.image_url || '', standard_price: p.standard_price || 0
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({ name: '', sku_code: '', category: '蔬菜', origin: '', grade: '', unit: '吨', description: '', image_url: '', standard_price: 0 });
    };

    // 选中切换
    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedIds(next);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredProducts.length) { setSelectedIds(new Set()); }
        else { setSelectedIds(new Set(filteredProducts.map(p => p.id))); }
    };

    // 批量删除
    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedIds.size} 个商品吗？此操作不可撤销！`)) return;
        const { error } = await supabase.from('products').delete().in('id', Array.from(selectedIds));
        if (error) alert('批量删除失败: ' + error.message);
        else { setSelectedIds(new Set()); fetchProducts(); }
    };

    // 导出
    const handleExport = () => {
        const exportData = (selectedIds.size > 0 ? products.filter(p => selectedIds.has(p.id)) : products).map(p => ({
            '商品名称': p.name,
            'SKU编码': p.sku_code,
            '分类': p.category,
            '产地': p.origin,
            '品级': p.grade,
            '单位': p.unit,
            '指导单价': p.standard_price,
            '描述': p.description
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '商品清单');
        const label = selectedIds.size > 0 ? `选中${selectedIds.size}项` : '全部';
        XLSX.writeFile(wb, `海露商品清单_${label}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    // 导入
    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        try {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(sheet);
            if (rows.length === 0) { alert('未检测到有效数据'); return; }

            const toInsert = rows.map(row => ({
                name: String(row['商品名称'] || row['name'] || '').trim(),
                sku_code: String(row['SKU编码'] || row['sku_code'] || '').trim(),
                category: String(row['分类'] || row['category'] || '其他').trim(),
                origin: String(row['产地'] || row['origin'] || '').trim(),
                grade: String(row['品级'] || row['grade'] || '').trim(),
                unit: String(row['单位'] || row['unit'] || '吨').trim(),
                standard_price: parseFloat(row['指导单价'] || row['standard_price']) || 0,
                description: String(row['描述'] || row['description'] || '').trim(),
            })).filter(r => r.name);

            if (toInsert.length === 0) { alert('没有合法的商品数据'); return; }
            const { error } = await supabase.from('products').insert(toInsert);
            if (error) alert('导入失败: ' + error.message);
            else { alert(`成功导入 ${toInsert.length} 个商品`); fetchProducts(); }
        } catch (err: any) {
            alert('导入异常: ' + err.message);
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
            {canEdit && (
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-800">
                        <span className={`w-3 h-8 ${editingId ? 'bg-amber-400' : 'bg-emerald-500'} rounded-lg shadow-sm`}></span> 
                        {editingId ? '编辑商品 SKU 信息' : '上架新农产品'}
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                        <div className="md:col-span-2 flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">商品名称</label>
                                    <input className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl focus:ring-2 focus:ring-emerald-200 outline-none" placeholder="例如：冰糖心苹果" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">核心分类</label>
                                    <select className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl focus:ring-2 focus:ring-emerald-200 outline-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">原产地</label>
                                    <input className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl outline-none" placeholder="例如：新疆阿克苏" value={formData.origin} onChange={e => setFormData({...formData, origin: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">品控等级</label>
                                    <input className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl outline-none" placeholder="例如：特级 / 一级" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">SKU 编码 (留空自动生成)</label>
                                    <input className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl font-mono text-xs outline-none" placeholder="自动生成" value={formData.sku_code} onChange={e => setFormData({...formData, sku_code: e.target.value})} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">市场指导单价 (¥)</label>
                                    <input type="number" className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl outline-none" value={formData.standard_price} onChange={e => setFormData({...formData, standard_price: parseFloat(e.target.value)||0})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">标准计价单位</label>
                                    <input className="w-full h-11 bg-slate-50 border border-slate-200 px-3 rounded-xl outline-none" placeholder="例如：吨 / 箱" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
                                </div>
                            </div>
                            
                            <div className="flex-1 flex flex-col">
                                <label className="block text-xs font-bold text-slate-500 mb-1">商品卖点与介绍 (选填)</label>
                                <textarea className="w-full flex-1 bg-slate-50 border border-slate-200 p-3 rounded-xl resize-none outline-none min-h-[80px]" placeholder="输入相关产品描述..." value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}></textarea>
                            </div>
                        </div>

                        <div className="flex flex-col h-full">
                            <label className="block text-xs font-bold text-slate-500 mb-1">商品高清主图 (图床直传)</label>
                            <div className="flex-1 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group min-h-[200px]">
                                {formData.image_url ? (
                                    <>
                                        <img src={formData.image_url} alt="预览" className="absolute inset-0 w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <button type="button" onClick={() => setFormData({...formData, image_url: ''})} className="bg-rose-500 text-white px-4 py-2 rounded-lg text-xs font-bold">移除重传</button>
                                        </div>
                                    </>
                                ) : (
                                    <label className="cursor-pointer flex flex-col items-center p-6 text-slate-400 hover:text-emerald-500 transition-colors">
                                        <span className="text-4xl mb-2">📸</span>
                                        <span className="text-xs font-bold">{isUploading ? '正在上传...' : '点击上传商品主图'}</span>
                                        <input type="file" accept="image/*" className="hidden" disabled={isUploading} onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            setIsUploading(true);
                                            try {
                                                const ext = file.name.split('.').pop();
                                                const uniqueName = `product_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                                                const { error } = await supabase.storage.from('trade-proofs').upload(uniqueName, file);
                                                if (!error) {
                                                    const { data } = supabase.storage.from('trade-proofs').getPublicUrl(uniqueName);
                                                    setFormData(prev => ({ ...prev, image_url: data.publicUrl }));
                                                } else {
                                                    alert('上传失败: ' + error.message);
                                                }
                                            } finally {
                                                setIsUploading(false);
                                            }
                                        }} />
                                    </label>
                                )}
                            </div>
                            <div className="text-[9px] text-slate-400 text-center font-bold">仅支持 jpg/png，系统将自动使用云端对象存储。</div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
                        {editingId && <button onClick={resetForm} className="px-6 py-3 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200">取消编辑</button>}
                        <button onClick={handleSubmit} className={`px-8 py-3 rounded-xl font-black tracking-wider text-white shadow-lg transition-all ${editingId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'}`}>
                            {editingId ? '💾 保存修改' : '+ 提交新农产品至类目库'}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black text-slate-800">全线农产品 SKU 资产清单</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="text"
                            placeholder="🔍 搜索商品名称、SKU、品类..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none w-56 transition-all"
                        />
                        {selectedIds.size > 0 && (
                            <button onClick={handleBatchDelete} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-xs font-black border border-rose-100 hover:bg-rose-600 hover:text-white transition-all">
                                🗑️ 删除选中 ({selectedIds.size})
                            </button>
                        )}
                        <button onClick={handleExport} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-black border border-blue-100 hover:bg-blue-600 hover:text-white transition-all">
                            📤 {selectedIds.size > 0 ? `导出选中 (${selectedIds.size})` : '导出全部'}
                        </button>
                        {canEdit && (
                            <label className={`px-4 py-2 rounded-xl text-xs font-black border cursor-pointer transition-all ${importing ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'}`}>
                                {importing ? '⏳ 导入中...' : '📥 导入商品'}
                                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} disabled={importing} />
                            </label>
                        )}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-y border-slate-100 text-slate-500 text-xs uppercase tracking-wider">
                                {canEdit && <th className="p-3 w-10">
                                    <input type="checkbox" className="w-4 h-4 rounded text-emerald-600" checked={filteredProducts.length > 0 && selectedIds.size === filteredProducts.length} onChange={toggleSelectAll} />
                                </th>}
                                <th className="p-3 font-black">商品主图</th>
                                <th className="p-3 font-black">类目与商品信息</th>
                                <th className="p-3 font-black">规格属性 (产地/等级/单位)</th>
                                <th className="p-3 font-black text-right">指导单价</th>
                                {canEdit && <th className="p-3 font-black text-right">操作</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredProducts.map(p => (
                                <tr key={p.id} className="hover:bg-emerald-50/30 transition-colors">
                                    {canEdit && <td className="p-3">
                                        <input type="checkbox" className="w-4 h-4 rounded text-emerald-600" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                                    </td>}
                                    <td className="p-3">
                                        <div className="w-12 h-12 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm">
                                            {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-xs text-slate-400 font-bold">无图</span>}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-800 text-base flex items-center gap-2">
                                                {p.name}
                                                {p.sku_code && <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 rounded font-mono">{p.sku_code}</span>}
                                            </span>
                                            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded w-max mt-1">{p.category}</span>
                                        </div>
                                    </td>
                                    <td className="p-3 text-xs text-slate-600">
                                        <div className="flex flex-col gap-1">
                                            <span>📍 产地: <span className="font-bold">{p.origin || '--'}</span></span>
                                            <span>🏷️ 等级: <span className="font-bold">{p.grade || '--'}</span></span>
                                            <span>📏 单位: <span className="font-bold bg-slate-100 px-1 rounded">{p.unit}</span></span>
                                        </div>
                                    </td>
                                    <td className="p-3 text-right">
                                        <span className="font-mono font-bold text-slate-700 text-base">¥{Number(p.standard_price).toLocaleString()}</span>
                                    </td>
                                    {canEdit && (
                                        <td className="p-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => startEdit(p)} className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded font-bold transition-colors">编辑</button>
                                                <button onClick={() => handleDelete(p.id, p.name)} className="text-xs text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded font-bold transition-colors">下架</button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {products.length === 0 && (
                                <tr><td colSpan={canEdit ? 6 : 5} className="p-10 text-center text-slate-400 font-bold">尚未建立任何商品资产记录。</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
