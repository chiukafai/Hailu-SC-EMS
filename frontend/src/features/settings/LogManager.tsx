import { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';

export default function LogManager() {
    const [logs, setLogs] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, string>>({});
    const [filters, setFilters] = useState({
        action_type: '',
        module: '',
        user_id: ''
    });

    const fetchLogs = async () => {
        let query = supabase.from('audit_logs').select('*', { count: 'exact' });
        
        if (filters.action_type) query = query.eq('action_type', filters.action_type);
        if (filters.module) query = query.ilike('module', `%${filters.module}%`);
        if (filters.user_id) query = query.eq('user_id', filters.user_id);

        query = query.order('created_at', { ascending: false }).limit(200);
        
        const { data } = await query;
        if (data) setLogs(data);
    };

    const fetchUsers = async () => {
        const { data } = await supabase.from('app_users').select('id, name');
        if (data) {
            const umap: Record<string, string> = {};
            data.forEach(u => { umap[u.id] = u.name; });
            setUsers(umap);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    useEffect(() => {
        fetchLogs();
    }, [filters]);

    const getActionColor = (action: string) => {
        switch (action) {
            case 'LOGIN': return 'bg-blue-50 text-blue-600 border-blue-200';
            case 'CREATE': return 'bg-emerald-50 text-emerald-600 border-emerald-200';
            case 'UPDATE': return 'bg-amber-50 text-amber-600 border-amber-200';
            case 'DELETE': return 'bg-rose-50 text-rose-600 border-rose-200';
            default: return 'bg-slate-50 text-slate-600 border-slate-200';
        }
    };

    return (
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 animate-fade-in">
            <h2 className="text-xl font-black mb-6 flex items-center gap-2 text-slate-800">
                <span className="w-3 h-8 bg-indigo-500 rounded-lg shadow-sm"></span> 
                系统操作审计日志
            </h2>

            {/* 筛选器 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">操作人</label>
                    <select className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm" value={filters.user_id} onChange={e => setFilters({...filters, user_id: e.target.value})}>
                        <option value="">全部人员</option>
                        {Object.entries(users).map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">操作动作</label>
                    <select className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm" value={filters.action_type} onChange={e => setFilters({...filters, action_type: e.target.value})}>
                        <option value="">全部动作</option>
                        <option value="LOGIN">登录系统 (LOGIN)</option>
                        <option value="CREATE">新增数据 (CREATE)</option>
                        <option value="UPDATE">更新数据 (UPDATE)</option>
                        <option value="DELETE">删除数据 (DELETE)</option>
                        <option value="EXPORT">导出数据 (EXPORT)</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">操作模块</label>
                    <input className="w-full bg-white border border-slate-200 p-2 rounded-lg text-sm" placeholder="例如：贸易数据" value={filters.module} onChange={e => setFilters({...filters, module: e.target.value})} />
                </div>
                <div className="flex items-end">
                    <button onClick={fetchLogs} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">🔍 刷新日志</button>
                </div>
            </div>

            {/* 日志列表 */}
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider">
                            <th className="p-3 font-black">操作时间</th>
                            <th className="p-3 font-black">操作人</th>
                            <th className="p-3 font-black">动作</th>
                            <th className="p-3 font-black">模块</th>
                            <th className="p-3 font-black">操作内容描述</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {logs.map(log => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="p-3 text-xs text-slate-500 font-mono whitespace-nowrap">
                                    {new Date(log.created_at).toLocaleString('zh-CN')}
                                </td>
                                <td className="p-3">
                                    <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                        {users[log.user_id] || '未知/系统'}
                                    </span>
                                </td>
                                <td className="p-3">
                                    <span className={`text-[10px] px-2 py-0.5 rounded border font-black ${getActionColor(log.action_type)}`}>
                                        {log.action_type}
                                    </span>
                                </td>
                                <td className="p-3 text-xs font-bold text-slate-600">
                                    {log.module}
                                </td>
                                <td className="p-3 text-xs text-slate-700 max-w-md truncate" title={log.description}>
                                    {log.description}
                                </td>
                            </tr>
                        ))}
                        {logs.length === 0 && (
                            <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold">暂无审计日志记录</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 text-center text-xs text-slate-400">系统仅展示最近 200 条操作记录。更早期的记录保存在数据库底层。</div>
        </div>
    );
}
