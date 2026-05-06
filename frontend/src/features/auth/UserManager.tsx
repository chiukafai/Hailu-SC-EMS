import { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';
import { chatService } from '../../services/chatService';

const ALL_MODULES = [
    { id: 'dash', name: '集团仪表盘' },
    { id: 'org', name: '组织架构' },
    { id: 'dept', name: '部门管理' },
    { id: 'client', name: '客户档案' },
    { id: 'products', name: '农产品商品库' },
    { id: 'invoices', name: '业务贸易数据' },
];

export default function UserManager({ currentUser }: { currentUser: any }) {
    const [users, setUsers] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [identityType, setIdentityType] = useState<'head' | 'staff' | 'custom'>('custom');
    const [selectedStaffName, setSelectedStaffName] = useState(''); 
    const [formData, setFormData] = useState({
        username: '', full_name: '', password: '', role: 'user', permissions: {} as Record<string, string>,
        department_id: '', org_id: '', is_department_head: false, client_id: ''
    });
    const [clients, setClients] = useState<any[]>([]);

    const fetchUsers = async () => {
        const { data } = await supabase.from('app_users').select('*, departments(name), organizations(name)').order('created_at', { ascending: true });
        if (data) setUsers(data);
    };

    const fetchDeps = async () => {
        const { data } = await supabase.from('departments').select('id, name, head, staff');
        if (data) setDepartments(data);
    };

    const fetchOrgs = async () => {
        const { data } = await supabase.from('organizations').select('id, name');
        if (data) setOrganizations(data);
    };

    const fetchClients = async () => {
        const { data } = await supabase.from('global_clients').select('id, tax_id, full_name');
        if (data) setClients(data.map(c => ({ id: c.tax_id, name: c.full_name }))); 
    };

    useEffect(() => { fetchUsers(); fetchDeps(); fetchOrgs(); fetchClients(); }, []);

    const handleIdentitySelect = (deptId: string, idType: 'head' | 'staff' | 'custom', staffName?: string) => {
        setIdentityType(idType);
        const nameToUse = staffName || '';
        setSelectedStaffName(nameToUse);
        setFormData(prev => {
            let nextObj = { ...prev, department_id: deptId, is_department_head: idType === 'head', full_name: nameToUse };
            if (idType !== 'custom' && deptId) {
                const dept = departments.find(d => d.id === deptId);
                if (dept) {
                    const autoName = idType === 'head' ? dept.head : (staffName || dept.staff?.split(',')?.[0] || '');
                    // Warn if this username already exists in the system
                    const existing = users.find(u => u.username === autoName.trim());
                    if (existing) {
                        setTimeout(() => alert(`⚠️ 账号 [${autoName.trim()}] 已存在！请选择"手动录入新身份"换一个登录账号，或编辑现有账号。`), 0);
                    }
                    nextObj.username = autoName.trim() || '';
                    nextObj.full_name = autoName.trim();
                }
            }
            return nextObj;
        });
    };

    const setPermission = (modId: string, level: string) => {
        setFormData(prev => {
            const newPerms = { ...prev.permissions };
            if (level === 'none') {
                delete newPerms[modId];
            } else {
                newPerms[modId] = level;
            }
            return { ...prev, permissions: newPerms };
        });
    };

    const handleSubmit = async () => {
        if (!formData.username || !formData.password || !formData.full_name) {
            alert('账号、密码及人员全称均不能为空'); return;
        }

        const submitData: any = { ...formData };
        if (!submitData.department_id) submitData.department_id = null;
        if (!submitData.org_id) submitData.org_id = null;
        if (!submitData.client_id || submitData.role !== 'client') submitData.client_id = null;
        
        if (submitData.role === 'client') {
            submitData.permissions = { dash: 'view', invoices: 'view' };
        } else if (submitData.role === 'admin') {
            const allPerms: any = {};
            ALL_MODULES.forEach(m => allPerms[m.id] = 'edit');
            submitData.permissions = allPerms;
        }

        if (editingId) {
            const { error } = await supabase.from('app_users').update(submitData).eq('id', editingId);
            if (error) alert(error.message);
            else { alert('账号凭证更新成功'); setEditingId(null); fetchUsers(); }
        } else {
            // Prevent duplicate username
            const { data: existingUser } = await supabase
                .from('app_users')
                .select('id, username')
                .eq('username', formData.username)
                .single();
            if (existingUser) {
                alert(`账号 [${formData.username}] 已被占用，请换一个登录账号再试！`);
                return;
            }

            const { data: newUsers, error } = await supabase.from('app_users').insert([submitData]).select('id');
            if (error) { alert(`建立失败：${error.message}`); return; }

            const newUserId = newUsers?.[0]?.id;
            if (newUserId && formData.department_id && formData.role !== 'client') {
                // 自动与同部门所有现有成员建立聊天连接
                const { data: deptMembers } = await supabase
                    .from('app_users')
                    .select('id')
                    .eq('department_id', formData.department_id)
                    .neq('id', newUserId);
                if (deptMembers) {
                    await Promise.all(deptMembers.map(m => chatService.ensureConnection(newUserId, m.id)));
                }
            }

            alert('干员凭证建立成功');
            resetForm();
            fetchUsers();
        }
    };

    const handleDelete = async (user: any) => {
        if (user.username === 'admin') {
            alert('系统最终管理员 admin 不可注销！'); return;
        }
        if (user.id === currentUser.id) {
            alert('无法注销当前操作账号！'); return;
        }
        if (confirm(`警告：确定将账号 [${user.full_name}] 移出防御阵列并注销凭证吗？`)) {
            await supabase.from('app_users').delete().eq('id', user.id);
            fetchUsers();
        }
    };

    const startEdit = (user: any) => {
        setEditingId(user.id);
        const savedPerms = (typeof user.permissions === 'object' && !Array.isArray(user.permissions))
            ? user.permissions 
            : {};
        
        setIdentityType(user.department_id ? (user.is_department_head ? 'head' : 'staff') : 'custom');
        setFormData({ 
            username: user.username, 
            full_name: user.full_name || '',
            password: user.password, 
            role: user.role, 
            permissions: savedPerms,
            department_id: user.department_id || '',
            org_id: user.org_id || '',
            is_department_head: !!user.is_department_head,
            client_id: user.client_id || ''
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingId(null);
        setIdentityType('custom');
        setSelectedStaffName('');
        setFormData({ username: '', full_name: '', password: '', role: 'user', permissions: {}, department_id: '', org_id: '', is_department_head: false, client_id: '' });
    };

    if (currentUser?.role !== 'admin') {
        return <div className="p-16 text-center text-slate-500 font-bold">权限受限：非中枢管理人员。</div>;
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-purple-900/5 border border-purple-50">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-black flex items-center gap-4 text-slate-800">
                        <span className={`w-3 h-10 ${editingId ? 'bg-amber-400' : 'bg-indigo-600'} rounded-full shadow-sm`}></span> 
                        {editingId ? '修正干员身份信息' : '发放新在编干员凭证'}
                    </h2>
                    {editingId && <button onClick={resetForm} className="text-xs font-black text-amber-600 bg-amber-50 px-4 py-2 rounded-xl">放弃修改</button>}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                    <div className="space-y-6">
                        <div>
                            <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">绑定所属子公司 / 集团机构</label>
                            <select className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold text-slate-700 transition-all outline-none mb-4" value={formData.org_id || ''} onChange={e => setFormData({ ...formData, org_id: e.target.value })}>
                                <option value="">🎯 [无绑定] 总部或直属账号</option>
                                {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>

                            <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">绑定所属部门 (选填)</label>
                            <select className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold text-slate-700 transition-all outline-none" value={formData.department_id || ''} onChange={e => {
                                const newDeptId = e.target.value;
                                if (!newDeptId) handleIdentitySelect('', 'custom');
                                else handleIdentitySelect(newDeptId, 'head');
                            }}>
                                <option value="">🎯 [无绑定] 外部或特定公共账号</option>
                                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            
                            {formData.department_id && (
                                <div className="mt-4">
                                    <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">选择具体在编人员</label>
                                    <select className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-100 focus:ring-4 focus:ring-indigo-100 font-bold text-slate-700 outline-none" value={`${identityType}|${selectedStaffName}`} onChange={e => {
                                        const [type, name] = e.target.value.split('|');
                                        if (type === 'custom') handleIdentitySelect(formData.department_id, 'custom');
                                        else handleIdentitySelect(formData.department_id, type as any, name);
                                    }}>
                                        {departments.find(d => d.id === formData.department_id)?.head && (
                                            <option value={`head|${departments.find(d => d.id === formData.department_id)?.head}`}>👑 负责人: {departments.find(d => d.id === formData.department_id)?.head}</option>
                                        )}
                                        {departments.find(d => d.id === formData.department_id)?.staff?.split(',').map((s: string) => s.trim()).filter((s: string) => s).map((s: string, idx: number) => (
                                            <option key={idx} value={`staff|${s}`}>💼 干员: {s}</option>
                                        ))}
                                        <option value="custom|">✏️ 手动录入新身份</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">人员全称 / 公司名称</label>
                            <input className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold text-slate-800" placeholder="例如：重庆安信粮丰" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} />
                            <p className="text-[9px] text-slate-400 mt-2 ml-1 font-bold">💡 此字段是搜索添加好友的关键字段</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">登录账号</label>
                                <input className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} disabled={formData.username === 'admin' && !!editingId} />
                            </div>
                            <div>
                                <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">登录密码</label>
                                <input className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold" placeholder="设置密码" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] text-slate-400 font-black mb-2 uppercase tracking-widest">系统权限级别</label>
                            <select className="w-full border border-slate-100 p-4 rounded-2xl bg-slate-50 focus:ring-4 focus:ring-indigo-100 font-bold" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} disabled={formData.username === 'admin' && !!editingId}>
                                <option value="user">普通用户权限 (User)</option>
                                <option value="admin">核心枢纽 (Admin)</option>
                                <option value="client">外部往来客商 (Client)</option>
                            </select>
                        </div>

                        {formData.role === 'client' && (
                            <div className="animate-in slide-in-from-top-2">
                                <label className="block text-[11px] text-amber-600 font-black mb-2 uppercase tracking-widest">强制绑定往来单位主体</label>
                                <select className="w-full border-2 border-amber-100 p-4 rounded-2xl bg-amber-50 focus:ring-4 focus:ring-amber-200 text-amber-900 font-black" value={formData.client_id} onChange={e => setFormData({ ...formData, client_id: e.target.value })}>
                                    <option value="">-- 请选择要映射的客户档案 --</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="md:col-span-2 bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100">
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">特定功能模块干涉权限配置</p>
                        <div className="grid grid-cols-1 gap-3">
                            {ALL_MODULES.map(mod => {
                                const currentLevel = formData.role === 'admin' ? 'edit' : (formData.permissions[mod.id] || 'none');
                                return (
                                    <div key={mod.id} className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                        <span className="text-sm font-black text-slate-700">{mod.name}</span>
                                        <div className="flex gap-2">
                                            {['none', 'view', 'edit'].map(lvl => (
                                                <label key={lvl} className={`px-5 py-2.5 rounded-xl text-[10px] font-black cursor-pointer transition-all ${currentLevel === lvl ? (lvl === 'none' ? 'bg-rose-600 text-white shadow-lg' : lvl === 'view' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-emerald-600 text-white shadow-lg') : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                                                    <input type="radio" className="hidden" checked={currentLevel === lvl} onChange={() => setPermission(mod.id, lvl)} disabled={formData.role === 'admin'} />
                                                    {lvl === 'none' ? '禁止访问' : lvl === 'view' ? '仅限监视' : '读写干涉'}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="mt-10 flex justify-end gap-4 pt-6 border-t border-slate-50">
                    <button onClick={resetForm} className="px-8 py-4 font-black text-slate-400 hover:text-slate-600 transition-colors">重置输入</button>
                    <button onClick={handleSubmit} className={`px-12 py-4 font-black tracking-widest text-white rounded-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 ${editingId ? 'bg-amber-500 shadow-amber-200' : 'bg-indigo-600 shadow-indigo-200'}`}>
                        {editingId ? '确认修正身份' : '确认录入档案'}
                    </button>
                </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                <h2 className="text-2xl font-black mb-8 text-slate-800 flex items-center justify-between">
                    <span>中枢节点人员总览</span>
                    <span className="text-xs bg-slate-100 px-4 py-2 rounded-xl text-slate-500 font-black">有效凭证总数: {users.length}</span>
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[11px] font-black tracking-widest text-slate-400 uppercase border-b border-slate-100">
                                <th className="pb-4 px-4">在编干员 / 登录账号</th>
                                <th className="pb-4 px-4">角色分类</th>
                                <th className="pb-4 px-4">模块访问状态</th>
                                <th className="pb-4 px-4 text-right">管理操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {users.map(u => (
                                <tr key={u.id} className="group hover:bg-slate-50/50 transition-colors">
                                    <td className="py-6 px-4">
                                        <div className="flex flex-col">
                                            <span className="font-black text-slate-800 text-base">{u.full_name || u.username}</span>
                                            <span className="text-[10px] text-slate-400 font-mono">ID: {u.username}</span>
                                            {u.departments && (
                                                <span className="text-[9px] mt-1 text-indigo-500 font-black uppercase">{u.departments.name}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-6 px-4">
                                        <span className={`text-[10px] font-black px-3 py-1 rounded-lg ${u.role === 'admin' ? 'bg-rose-50 text-rose-600' : u.role === 'client' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                            {u.role === 'admin' ? '核心枢纽' : u.role === 'client' ? '外部客商' : '普通用户'}
                                        </span>
                                    </td>
                                    <td className="py-6 px-4">
                                        <div className="flex flex-wrap gap-1">
                                            {u.role === 'admin' ? <span className="text-[10px] font-black text-emerald-600">全模块读写干涉</span> : 
                                                Object.keys(u.permissions || {}).length > 0 ? <span className="text-[10px] font-black text-slate-400">已配置 {Object.keys(u.permissions).length} 项权限</span> : <span className="text-[10px] text-slate-300 italic">暂无权限分配</span>
                                            }
                                        </div>
                                    </td>
                                    <td className="py-6 px-4 text-right">
                                        <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => startEdit(u)} className="text-[11px] font-black text-indigo-600 hover:underline">修正</button>
                                            <button onClick={() => handleDelete(u)} className="text-[11px] font-black text-rose-500 hover:underline">注销</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
