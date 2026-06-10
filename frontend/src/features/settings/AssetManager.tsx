import { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';

export default function AssetManager() {
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [isUploading, setIsUploading] = useState(false);

    const fetchAssets = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('system_attachments')
            .select('*')
            .order('created_at', { ascending: false });
        if (!error && data) {
            setAssets(data);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchAssets();
    }, []);

    const handleDelete = async (id: string, url: string, fileName: string) => {
        if (!window.confirm(`确定要彻底删除该附件吗？\n[${fileName || '无名附件'}]\n此操作不可逆！`)) return;
        
        // 1. Remove from database
        await supabase.from('system_attachments').delete().eq('id', id);

        // 2. Try to remove from storage (optional but recommended to save space)
        // Extract filename from URL (we assume it's at the end)
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            const storageFileName = pathParts[pathParts.length - 1];
            if (storageFileName) {
                await supabase.storage.from('trade-proofs').remove([storageFileName]);
            }
        } catch (e) {
            console.error("Storage cleanup failed:", e);
        }

        fetchAssets();
    };

    return (
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                            <span className="w-3 h-8 bg-blue-600 rounded-lg shadow-sm"></span> 
                            附件管理中心
                        </h2>
                        <p className="text-xs text-slate-500 font-bold mt-2 ml-6">
                            在此可以集中管理所有模块上传的原始凭证、合同和相关附件资料。
                        </p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <label className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isUploading ? 'bg-indigo-100 text-indigo-500' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'}`}>
                            {isUploading ? '正在极速上传...' : '📤 独立上传文件至图床'}
                            <input type="file" multiple className="hidden" disabled={isUploading} onChange={async (e) => {
                                const files = e.target.files;
                                if (!files || files.length === 0) return;
                                setIsUploading(true);
                                try {
                                    for (let i = 0; i < files.length; i++) {
                                        const file = files[i];
                                        const ext = file.name.split('.').pop();
                                        const uniqueName = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                                        const { error } = await supabase.storage.from('trade-proofs').upload(uniqueName, file);
                                        if (error) {
                                            alert(`文件 ${file.name} 上传云端失败: ${error.message}`);
                                            continue;
                                        }
                                        const { data: urlData } = supabase.storage.from('trade-proofs').getPublicUrl(uniqueName);
                                        
                                        // Register it in the database
                                        await supabase.from('system_attachments').insert([{
                                            file_name: file.name,
                                            file_url: urlData.publicUrl,
                                            relate_module: 'standalone_upload',
                                            relate_id: crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-0000-0000-000000000000'
                                        }]);
                                    }
                                    fetchAssets();
                                } finally {
                                    setIsUploading(false);
                                    if (e.target) e.target.value = '';
                                }
                            }} />
                        </label>
                        <button onClick={fetchAssets} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-colors">
                            🔄 刷新列表
                        </button>
                        <div className="flex bg-slate-100 rounded-lg p-1">
                            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>画廊</button>
                            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>列表</button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="py-20 text-center font-bold text-slate-400">正在检索云端存储桶...</div>
                ) : assets.length === 0 ? (
                    <div className="py-20 text-center font-bold text-slate-400">目前系统云端存储池中没有找到任何附件。</div>
                ) : (
                    <>
                        {viewMode === 'grid' ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                {assets.map(asset => {
                                    const isImage = asset.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
                                    return (
                                        <div key={asset.id} className="group flex flex-col bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden hover:shadow-xl transition-all">
                                            <div className="aspect-square bg-slate-200 relative overflow-hidden flex items-center justify-center">
                                                {isImage ? (
                                                    <img src={asset.file_url} alt={asset.file_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                                                ) : (
                                                    <div className="text-4xl">📄</div>
                                                )}
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex flex-col gap-2 items-center justify-center opacity-0 group-hover:opacity-100 backdrop-blur-sm">
                                                    <a href={asset.file_url} target="_blank" rel="noreferrer" className="bg-white/90 text-slate-900 text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-white transition-colors hover:scale-105">
                                                        查看原件
                                                    </a>
                                                    <button onClick={() => {
                                                        navigator.clipboard.writeText(asset.file_url);
                                                        alert('CDN 网址已复制到剪贴板！');
                                                    }} className="bg-indigo-600/90 text-white text-[10px] font-bold px-4 py-1.5 rounded-lg hover:bg-indigo-600 transition-colors hover:scale-105 shadow-md">
                                                        🔗 复制公网链接
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="p-3">
                                                <div className="text-xs font-bold text-slate-800 truncate" title={asset.file_name}>{asset.file_name || '未命名附件'}</div>
                                                <div className="flex justify-between items-center mt-2">
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 font-bold rounded">
                                                        模块: {asset.relate_module}
                                                    </span>
                                                    <button onClick={() => handleDelete(asset.id, asset.file_url, asset.file_name)} className="text-[10px] text-rose-500 hover:text-rose-700 font-bold hover:underline">删除</button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-slate-100 text-slate-400 font-black text-xs uppercase tracking-wider">
                                            <th className="py-3 px-4">原始文件名</th>
                                            <th className="py-3 px-4">关联模块</th>
                                            <th className="py-3 px-4">关联核心ID</th>
                                            <th className="py-3 px-4">上传时间</th>
                                            <th className="py-3 px-4 text-right">管理操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {assets.map(asset => (
                                            <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="py-3 px-4">
                                                    <a href={asset.file_url} target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline flex items-center gap-2">
                                                        <span>{asset.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? '🖼️' : '📄'}</span>
                                                        {asset.file_name || '未命名附件'}
                                                    </a>
                                                </td>
                                                <td className="py-3 px-4 font-bold text-slate-600"><span className="bg-slate-100 px-2 py-1 rounded-md">{asset.relate_module}</span></td>
                                                <td className="py-3 px-4 text-xs font-mono text-slate-400">{asset.relate_id}</td>
                                                <td className="py-3 px-4 text-xs text-slate-500 font-medium">{new Date(asset.created_at).toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right flex justify-end gap-2">
                                                    <button onClick={() => {
                                                        navigator.clipboard.writeText(asset.file_url);
                                                        alert('CDN 网址已复制到剪贴板！');
                                                    }} className="text-xs bg-indigo-50 text-indigo-600 font-bold px-3 py-1.5 rounded-md hover:bg-indigo-100 transition-colors">复制 URL</button>
                                                    <button onClick={() => handleDelete(asset.id, asset.file_url, asset.file_name)} className="text-xs bg-rose-50 text-rose-600 font-bold px-3 py-1.5 rounded-md hover:bg-rose-100 transition-colors">彻底删除</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
