import React, { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';

const ALL_MODULES = [
    { id: 'dash', name: '集团仪表盘' },
    { id: 'org', name: '组织架构' },
    { id: 'dept', name: '部门管理' },
    { id: 'client', name: '客户档案' },
    { id: 'invoices', name: '业务贸易数据中心' },
];

export default function UserManager({ currentUser }: { currentUser: any }) {
    const [users, setUsers] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [identityType, setIdentityType] = useState<'head' | 'staff' | 'custom'>('custom');
    const [selectedStaffName, setSelectedStaffName] = useState(''); // Tracking exact staff name for multiple-staff lists
    const [formData, setFormData] = useState({
        username: '', password: '', role: 'user', permissions: {} as Record<string, string>,
        department_id: '', is_department_head: false
    });

    const fetchUsers = async () => {
        const { data } = await supabase.from('app_users').select('*, departments(name)').order('created_at', { ascending: true });
        if (data) setUsers(data);
    };

    const fetchDeps = async () => {
        const { data } = await supabase.from('departments').select('id, name, head, staff');
        if (data) setDepartments(data);
    };

    useEffect(() => { fetchUsers(); fetchDeps(); }, []);

    const handleIdentitySelect = (deptId: string, idType: 'head' | 'staff' | 'custom', staffName?: string) => {
        setIdentityType(idType);
        setSelectedStaffName(staffName || '');
        setFormData(prev => {
            let nextObj = { ...prev, department_id: deptId, is_department_head: idType === 'head' };
            if (idType !== 'custom' && deptId) {
                const dept = departments.find(d => d.id === deptId);
                if (dept) {
                    const autoName = idType === 'head' ? dept.head : (staffName || dept.staff?.split(',')?.[0] || '');
                    nextObj.username = autoName.trim() || '';
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
        if (!formData.username || !formData.password) {
            alert('账号和密码不能为空'); return;
        }

        const submitData: any = { ...formData };
        if (!submitData.department_id) submitData.department_id = null;
        if (submitData.role === 'admin') {
            const allPerms: any = {};
            ALL_MODULES.forEach(m => allPerms[m.id] = 'edit');
            submitData.permissions = allPerms;
        }

        if (editingId) {
            const { error } = await supabase.from('app_users').update(submitData).eq('id', editingId);
            if (error) alert(error.message);
            else { alert('账号更新成功'); setEditingId(null); fetchUsers(); }
        } else {
            const { error } = await supabase.from('app_users').insert([submitData]);
            if (error) alert(`建立失败，可能该名字已经被占用。${error.message}`);
            else { alert('账号建立成功'); resetForm(); fetchUsers(); }
        }
    };

    const handleDelete = async (user: any) => {
        if (user.username === 'admin') {
            alert('系统最终管理员 admin 不可删除！'); return;
        }
        if (user.id === currentUser.id) {
            alert('您不能删除自己当前用于登入系统的账号！\n如果要撤销，请联系其他管理账户或改名操作。'); return;
        }
        if (confirm(`警告：确定将账号 [${user.username}] 直接从集团注销屏蔽吗？该员工将立刻无法访问内网！`)) {
            await supabase.from('app_users').delete().eq('id', user.id);
            fetchUsers();
        }
    };

    const startEdit = (user: any) => {
        setEditingId(user.id);
        const savedPerms = (typeof user.permissions === 'object' && !Array.isArray(user.permissions))
            ? user.permissions 
            : {};
        // Also support old array data if people didn't drop table/schema
        if (Array.isArray(user.permissions)) {
            user.permissions.forEach((p: string) => savedPerms[p] = 'edit');
        }

        setIdentityType(user.department_id ? (user.is_department_head ? 'head' : 'staff') : 'custom');
        setFormData({ 
            username: user.username, 
            password: user.password, 
            role: user.role, 
            permissions: savedPerms,
            department_id: user.department_id || '',
            is_department_head: !!user.is_department_head
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingId(null);
        setIdentityType('custom');
        setSelectedStaffName('');
        setFormData({ username: '', password: '', role: 'user', permissions: {}, department_id: '', is_department_head: false });
    };

    if (currentUser?.role !== 'admin') {
        return <div className="p-16 text-center text-slate-500 font-bold">安全拦截：抱歉，您的当前身份标签无法进入人权中枢。</div>;
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl shadow-lg shadow-purple-900/5 border border-purple-100">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-black flex items-center gap-3 text-slate-800">
                        <span className={`w-3 h-8 ${editingId ? 'bg-amber-400' : 'bg-purple-600'} rounded-lg shadow-sm`}></span> 
                        {editingId ? '特殊通道：修订已有干员档案' : '中枢节点：发放新在编干员凭证'}
                    </h2>
                    {editingId && <button onClick={resetForm} className="text-xs font-bold text-amber-600 underline">强制退出录入通道</button>}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] text-slate-400 font-black mb-1.5 uppercase">授权对象 (员工来源)</label>
                            <select className="w-full border-none p-3.5 rounded-xl bg-slate-50 focus:ring-2 focus:ring-purple-200 mb-2 font-bold text-slate-700" value={formData.department_id || ''} onChange={e => {
                                const newDeptId = e.target.value;
                                if (!newDeptId) handleIdentitySelect('', 'custom');
                                else handleIdentitySelect(newDeptId, 'head');
                            }}>
                                <option value="">🎯 [无绑定] 集团总部超级管理员或独立账号</option>
                                {/* Filter unique department names just in case older duplicate data exists */}
                                {Array.from(new Map(departments.map(d => [d.name, d])).values()).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            
                            {formData.department_id && (
                                <div className="flex flex-col gap-2 mb-4">
                                    <label className="block text-[10px] text-slate-400 font-black mt-2 uppercase">选择具体在编员工 (可下拉选择多位经办人)</label>
                                    <select className="w-full border-none p-3.5 rounded-xl bg-slate-100 focus:ring-2 focus:ring-purple-200 font-bold text-slate-700" value={`${identityType}|${selectedStaffName}`} onChange={e => {
                                        const [type, name] = e.target.value.split('|');
                                        if (type === 'custom') handleIdentitySelect(formData.department_id, 'custom');
                                        else handleIdentitySelect(formData.department_id, type as any, name);
                                    }}>
                                        {departments.find(d => d.id === formData.department_id)?.head && (
                                            <option value={`head|${departments.find(d => d.id === formData.department_id)?.head}`}>👑 部门负责人: {departments.find(d => d.id === formData.department_id)?.head}</option>
                                        )}
                                        {departments.find(d => d.id === formData.department_id)?.staff?.split(',').map((s: string) => s.trim()).filter((s: string) => s).map((s: string, idx: number) => (
                                            <option key={idx} value={`staff|${s}`}>💼 普通经办人: {s}</option>
                                        ))}
                                        <option value="custom|">✏️ 纯手工输入特殊名字</option>
                                    </select>
                                    {!formData.username && identityType !== 'custom' && <p className="text-[10px] text-rose-500 mt-1 font-bold">警告：此职位目前无记录人名，无法创建账号！</p>}
                                </div>
                            )}

                            {(!formData.department_id || identityType === 'custom') && (
                                <div className="mt-4">
                                    <label className="block text-[10px] text-slate-400 font-black mb-1.5 uppercase">特设账号名称 (Username)</label>
                                    <input className="w-full border-none p-3.5 rounded-xl bg-slate-50 focus:ring-2 focus:ring-purple-200 placeholder-slate-300" placeholder="例如：总经办" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} disabled={formData.username === 'admin' && !!editingId} />
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 font-black mb-1.5 uppercase">分配独立加密钥匙 (Passphrase)</label>
                            <input className="w-full border-none p-3.5 rounded-xl bg-slate-50 focus:ring-2 focus:ring-purple-200" placeholder="首次登录密码" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            {editingId && <p className="text-[9px] text-emerald-600 mt-1 ml-1 font-bold">您可以直接覆盖输入新的密码为员工进行重置</p>}
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-400 font-black mb-1.5 uppercase">特权级别与防线豁免</label>
                            <select className="w-full border-none p-3.5 rounded-xl bg-slate-50 focus:ring-2 focus:ring-purple-200" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} disabled={formData.username === 'admin' && !!editingId}>
                                <option value="user">USER / 被控访问专员 (受板块分配约束)</option>
                                <option value="admin">ADMIN / 统御级核心节点 (贯穿系统防线)</option>
                            </select>
                        </div>
                    </div>
                    <div className="md:col-span-2 bg-slate-50/80 p-5 rounded-2xl border border-slate-100">
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">精准数据穿透授权池 (Data Clearances)</p>
                        <div className="flex flex-col gap-3">
                            {ALL_MODULES.map(mod => {
                                const currentLevel = formData.role === 'admin' ? 'edit' : (formData.permissions[mod.id] || 'none');
                                return (
                                    <div key={mod.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex-wrap gap-2">
                                        <span className="text-sm font-bold text-slate-700 md:w-32">{mod.name}</span>
                                        <div className="flex gap-2">
                                            <label className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${currentLevel === 'none' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                                                <input type="radio" className="hidden" checked={currentLevel === 'none'} onChange={() => setPermission(mod.id, 'none')} disabled={formData.role === 'admin'} />
                                                🚫 拦截访问
                                            </label>
                                            <label className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${currentLevel === 'view' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                                                <input type="radio" className="hidden" checked={currentLevel === 'view'} onChange={() => setPermission(mod.id, 'view')} disabled={formData.role === 'admin'} />
                                                👁️ 仅浏览数据
                                            </label>
                                            <label className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${currentLevel === 'edit' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                                                <input type="radio" className="hidden" checked={currentLevel === 'edit'} onChange={() => setPermission(mod.id, 'edit')} disabled={formData.role === 'admin'} />
                                                ✏️ 满编读写权
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {formData.role === 'admin' && <p className="text-[10px] text-purple-600 mt-4 px-2 font-bold bg-purple-50 p-2 rounded inline-block">&gt;_ 当前设定为系统管理员：将无视限制，在后台开启满编强制穿透模式。</p>}
                    </div>
                </div>
                <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button onClick={handleSubmit} className={`px-10 py-4 font-black tracking-widest text-white rounded-xl shadow-xl transition-all hover:scale-105 ${editingId ? 'bg-amber-500 shadow-amber-500/20 hover:bg-amber-600' : 'bg-gradient-to-r from-purple-600 to-indigo-600 shadow-indigo-600/20'}`}>
                        {editingId ? '>> 固化修改' : '+ 发放验证密钥凭空降落干员'}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-black mb-6 text-slate-800 flex items-center justify-between">
                    <span>系统防御阵列监视：目前所有授信节点与干员</span>
                    <span className="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-500 font-mono">Total Valid: {users.length}</span>
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[11px] font-black tracking-widest text-slate-400 uppercase border-b border-slate-100">
                                <th className="pb-3 px-3">系统认证 ID</th>
                                <th className="pb-3 px-3">当前活跃明文凭证</th>
                                <th className="pb-3 px-3">特权阶层</th>
                                <th className="pb-3 px-3 w-1/3">访问视野与数据暴露面积</th>
                                <th className="pb-3 px-3 text-right">紧急行政指令</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-sm">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="py-5 px-3 font-black text-slate-800">
                                        <div className="flex flex-col gap-1 items-start">
                                            <span>{u.username}</span>
                                            {u.departments && (
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded-sm flex items-center gap-1 ${u.is_department_head ? "bg-amber-50 shadow-sm border border-amber-100 text-amber-700 font-bold" : "bg-slate-100 text-slate-500 font-medium"}`}>
                                                    {u.is_department_head ? '👑' : '💼'} {u.departments.name}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-5 px-3">
                                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-500 font-mono text-[11px] select-all cursor-text">{u.password}</span>
                                    </td>
                                    <td className="py-5 px-3">
                                        {u.role === 'admin' ? <span className="bg-rose-100 text-rose-700 text-[10px] font-black uppercase px-2 py-0.5 rounded shadow-sm">核心枢纽 (ADMIN)</span> : <span className="bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-bold uppercase px-2 py-0.5 rounded shadow-sm">授信终点 (USER)</span>}
                                    </td>
                                    <td className="py-5 px-3">
                                        {u.role === 'admin' ? (
                                            <span className="text-[10px] font-black tracking-widest text-emerald-600 opacity-80">[ ALL PANELS GRANTED ]</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-1">
                                                {Object.entries((typeof u.permissions === 'object' && !Array.isArray(u.permissions)) ? u.permissions : {}).map(([pId, level]) => {
                                                    const name = ALL_MODULES.find(m => m.id === pId)?.name || pId;
                                                    return (
                                                        <span key={pId} className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2.5 py-1 rounded border border-slate-200">
                                                            {name}: {level === 'edit' ? '✅ 读写' : '👁️ 只读'}
                                                        </span>
                                                    );
                                                })}
                                                {(!u.permissions || Object.keys(u.permissions).length === 0 || Array.isArray(u.permissions)) && <span className="text-slate-400 text-xs italic">无任何准入权或需重新分级</span>}
                                            </div>
                                        )}
                                    </td>
                                    <td className="py-5 px-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => startEdit(u)} className="text-[11px] bg-white border-2 border-slate-200 text-slate-600 px-4 py-1.5 rounded-lg font-black hover:bg-slate-800 hover:border-slate-800 hover:text-white transition-all">干涉</button>
                                            <button onClick={() => handleDelete(u)} className="text-[11px] bg-rose-50 border border-transparent text-rose-600 px-4 py-1.5 rounded-lg font-black hover:bg-rose-600 hover:text-white transition-all shadow-sm">除名</button>
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
