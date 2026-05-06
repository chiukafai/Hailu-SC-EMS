import React, { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';

interface StaffMember {
    name: string;
    post: string;
    phone: string;
}

export default function DepartmentManager({ permissionLevel = 'edit' }: { permissionLevel?: string }) {
    const canEdit = permissionLevel === 'edit' || permissionLevel === 'admin';
    const [depts, setDepts] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    const initialForm = {
        name: '', 
        head: '', 
        head_post: '', 
        head_phone: '', 
        staff_members: [{ name: '', post: '', phone: '' }] as StaffMember[]
    };

    const [formData, setFormData] = useState(initialForm);
    const [existingDeptMatch, setExistingDeptMatch] = useState<any>(null);

    const fetchDepts = async () => {
        const { data } = await supabase.from('departments').select('*').order('created_at');
        if (data) setDepts(data);
    };

    useEffect(() => { fetchDepts(); }, []);

    // Standardize staff parsing from DB strings
    const parseStaff = (dept: any): StaffMember[] => {
        const names = dept.staff ? dept.staff.split(',').map((s: string) => s.trim()) : [];
        const posts = dept.staff_post ? dept.staff_post.split(',').map((s: string) => s.trim()) : [];
        const phones = dept.staff_phone ? dept.staff_phone.split(',').map((s: string) => s.trim()) : [];
        
        const count = Math.max(names.length, posts.length, phones.length);
        const members: StaffMember[] = [];
        for (let i = 0; i < count; i++) {
            members.push({
                name: names[i] || '',
                post: posts[i] || '',
                phone: phones[i] || ''
            });
        }
        return members.length > 0 ? members : [{ name: '', post: '', phone: '' }];
    };

    const handleSubmit = async () => {
        if (!formData.name || !formData.head) {
            alert("部门名称和负责人为必填项");
            return;
        }

        // Filter out empty staff rows
        const validStaff = formData.staff_members.filter(m => m.name.trim());
        
        const submitData = {
            name: formData.name.trim(),
            head: formData.head.trim(),
            head_post: formData.head_post.trim(),
            head_phone: formData.head_phone.trim(),
            staff: validStaff.map(m => m.name.trim()).join(', '),
            staff_post: validStaff.map(m => m.post.trim()).join(', '),
            staff_phone: validStaff.map(m => m.phone.trim()).join(', ')
        };

        if (editingId) {
            // Update primary record with merged staff, then delete all other duplicates
            const { error: updateError } = await supabase.from('departments').update(submitData).eq('id', editingId);
            if (updateError) {
                alert(updateError.message);
            } else {
                // Delete all other records with the same department name (dedup)
                const { data: duplicates } = await supabase
                    .from('departments')
                    .select('id')
                    .eq('name', submitData.name)
                    .neq('id', editingId);
                if (duplicates && duplicates.length > 0) {
                    await supabase.from('departments').delete().in('id', duplicates.map((d: any) => d.id));
                }
                alert('部门信息已更新');
                resetForm();
                fetchDepts();
            }
        } else if (existingDeptMatch) {
            // Append staff to existing department
            const currentMembers = parseStaff(existingDeptMatch);
            // Deduplicate if needed - for now allow duplicates if requested, but usually unique by name
            const mergedMembers = [...currentMembers, ...validStaff];
            
            const updatePayload = {
                staff: mergedMembers.map(m => m.name).join(', '),
                staff_post: mergedMembers.map(m => m.post).join(', '),
                staff_phone: mergedMembers.map(m => m.phone).join(', ')
            };

            const { error } = await supabase.from('departments').update(updatePayload).eq('id', existingDeptMatch.id);
            if (error) alert(error.message);
            else {
                alert('已追加成员到现有部门');
                resetForm();
                fetchDepts();
            }
        } else {
            const { error } = await supabase.from('departments').insert([submitData]);
            if (error) alert(error.message);
            else {
                alert('职能部门信息已保存');
                resetForm();
                fetchDepts();
            }
        }
    };

    const handleDelete = async (ids: string | string[], name: string) => {
        if (window.confirm(`确定要撤销 [${name}] 部门吗？（包含其下所有历史数据合并项）`)) {
            const idArray = Array.isArray(ids) ? ids : [ids];
            const { error } = await supabase.from('departments').delete().in('id', idArray);
            if (error) alert(error.message);
            else fetchDepts();
        }
    };

    const startEdit = async (dept: any) => {
        // Fetch ALL records with the same department name for merge-edit
        const { data: allDepts } = await supabase
            .from('departments')
            .select('*')
            .eq('name', dept.name)
            .order('created_at');

        if (!allDepts || allDepts.length === 0) return;

        // Merge staff from all records of the same name
        const mergedStaff: StaffMember[] = [];
        allDepts.forEach(d => {
            const members = parseStaff(d);
            members.forEach(m => {
                if (m.name && !mergedStaff.some(existing => existing.name === m.name)) {
                    mergedStaff.push(m);
                }
            });
        });

        const primary = allDepts[0];
        setEditingId(primary.id);
        setFormData({
            name: primary.name,
            head: primary.head || '',
            head_post: primary.head_post || '',
            head_phone: primary.head_phone || '',
            staff_members: mergedStaff.length > 0 ? mergedStaff : [{ name: '', post: '', phone: '' }]
        });
        // Refresh depts so right panel shows the same merged data
        fetchDepts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingId(null);
        setExistingDeptMatch(null);
        setFormData(initialForm);
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setFormData({ ...formData, name: val });
        
        if (!editingId) {
            const match = depts.find(d => d.name === val.trim());
            if (match) {
                setExistingDeptMatch(match);
                setFormData(prev => ({ 
                    ...prev, 
                    name: val, 
                    head: match.head, 
                    head_post: match.head_post || '',
                    head_phone: match.head_phone || '' 
                }));
            } else {
                setExistingDeptMatch(null);
                setFormData(prev => ({ ...prev, name: val }));
            }
        }
    };

    const addStaffRow = () => {
        setFormData({
            ...formData,
            staff_members: [...formData.staff_members, { name: '', post: '', phone: '' }]
        });
    };

    const removeStaffRow = (index: number) => {
        const newList = [...formData.staff_members];
        newList.splice(index, 1);
        setFormData({
            ...formData,
            staff_members: newList.length > 0 ? newList : [{ name: '', post: '', phone: '' }]
        });
    };

    const updateStaffMember = (index: number, field: string, value: string) => {
        const newList = [...formData.staff_members];
        newList[index] = { ...newList[index], [field]: value };
        setFormData({ ...formData, staff_members: newList });
    };

    const filteredDepts = depts.filter(d =>
        d.name?.includes(searchTerm) || d.head?.includes(searchTerm) || d.staff?.includes(searchTerm)
    );

    // Dynamic Database Deduplication Grouping (dedup by staff name)
    const groupedDepts = Object.values(filteredDepts.reduce((acc: any, dept: any) => {
        if (!acc[dept.name]) {
            acc[dept.name] = { ...dept, rawIds: [dept.id] };
        } else {
            acc[dept.name].rawIds.push(dept.id);
            // Deduplicate staff by name (keep first occurrence's post/phone)
            const nextStaff = parseStaff(dept);
            nextStaff.forEach(s => {
                if (s.name && !acc[dept.name]._staffMap?.has(s.name)) {
                    if (!acc[dept.name]._staffMap) acc[dept.name]._staffMap = new Map();
                    acc[dept.name]._staffMap.set(s.name, s);
                }
            });
            const merged = Array.from(acc[dept.name]._staffMap.values()) as StaffMember[];
            acc[dept.name].staff = merged.map(c => c.name).join(', ');
            acc[dept.name].staff_post = merged.map(c => c.post).join(', ');
            acc[dept.name].staff_phone = merged.map(c => c.phone).join(', ');

            if (!acc[dept.name].head && dept.head) {
                acc[dept.name].head = dept.head;
                acc[dept.name].head_post = dept.head_post;
                acc[dept.name].head_phone = dept.head_phone;
            }
        }
        return acc;
    }, {}));

    return (
        <div className="p-6 max-w-[1400px] mx-auto min-h-screen">
            <div className="flex flex-col lg:flex-row gap-8 print:hidden">

                {/* 左侧：录入/编辑面板 */}
                {canEdit && (
                <div className="lg:w-2/5 bg-white p-6 rounded-3xl border border-slate-200 shadow-xl h-fit sticky top-6">
                    <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                        <span className={`w-2 h-6 ${editingId ? 'bg-indigo-500' : 'bg-slate-900'} rounded-full`}></span>
                        {editingId ? '编辑部门构架' : '新增职能部门'}
                    </h2>

                    <div className="space-y-6">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">部门识别 / Name</label>
                            <input value={formData.name} className="w-full border-none bg-slate-50 p-3.5 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="部门名称 (如: 市场部)*" onChange={handleNameChange} />
                            {existingDeptMatch && !editingId && <p className="text-[10px] text-indigo-500 font-bold ml-1 italic animate-pulse">✨ 识别到已存部门，将智能合并经办人信息</p>}
                        </div>

                        {/* Head Section */}
                        <div className="bg-amber-50/50 p-5 rounded-2xl border border-amber-100/50 space-y-4 shadow-inner">
                            <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest block">部门负责人 (管理层)</label>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[9px] text-amber-500 font-bold uppercase pl-1">姓名*</label>
                                    <input value={formData.head} disabled={!!existingDeptMatch && !editingId} className="w-full border-none p-3 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-amber-200 outline-none" placeholder="任免姓名" onChange={e => setFormData({ ...formData, head: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] text-amber-500 font-bold uppercase pl-1">岗位</label>
                                    <input value={formData.head_post} disabled={!!existingDeptMatch && !editingId} className="w-full border-none p-3 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-amber-200 outline-none" placeholder="职位/衔级" onChange={e => setFormData({ ...formData, head_post: e.target.value })} />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] text-amber-500 font-bold uppercase pl-1">联系电话</label>
                                <input value={formData.head_phone} disabled={!!existingDeptMatch && !editingId} className="w-full border-none p-3 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-amber-200 outline-none" placeholder="手机号/座机" onChange={e => setFormData({ ...formData, head_phone: e.target.value })} />
                            </div>
                        </div>

                        {/* Staff Section */}
                        <div className="space-y-3">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">经办人明细 / Handlers</label>
                                <button onClick={addStaffRow} className="text-[10px] font-black bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shadow-sm">+ 添加成员</button>
                            </div>
                            
                            <div className="max-h-[380px] overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                                {formData.staff_members.map((member, idx) => (
                                    <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 group relative hover:border-indigo-100 transition-all">
                                        <div className="grid grid-cols-2 gap-3 mb-3">
                                            <div className="space-y-1">
                                                <input value={member.name} className="w-full border-none p-2.5 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="经办人姓名" onChange={e => updateStaffMember(idx, 'name', e.target.value)} />
                                            </div>
                                            <div className="space-y-1">
                                                <input value={member.post} className="w-full border-none p-2.5 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="岗位岗位" onChange={e => updateStaffMember(idx, 'post', e.target.value)} />
                                            </div>
                                        </div>
                                        <input value={member.phone} className="w-full border-none p-2.5 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="手机号" onChange={e => updateStaffMember(idx, 'phone', e.target.value)} />
                                        
                                        <button onClick={() => removeStaffRow(idx)} className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-white border border-slate-200 text-rose-500 rounded-full flex items-center justify-center text-[10px] shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500 hover:text-white">✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button onClick={handleSubmit} className={`flex-1 ${editingId ? 'bg-emerald-600 shadow-emerald-200' : 'bg-slate-900 shadow-slate-200'} text-white font-black py-4 rounded-[1.25rem] shadow-xl transition-all hover:scale-[1.01] active:scale-95`}>
                                {editingId ? '💾 固化架构并同步' : '📜 确认编制并生效'}
                            </button>
                            {editingId && <button onClick={resetForm} className="px-6 py-4 bg-slate-100 text-slate-500 rounded-[1.25rem] font-bold hover:bg-slate-200 transition-colors">取消</button>}
                        </div>
                    </div>
                </div>
                )}

                {/* 右侧：列表视图 */}
                <div className={`${canEdit ? 'lg:w-3/5' : 'w-full'} space-y-4`}>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-3">
                        <div className="flex items-center gap-3">
                            <h2 className="text-base font-black text-slate-800">部门总览</h2>
                            <span className="text-[9px] bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg font-black tracking-widest">{groupedDepts.length} 个部门</span>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <div className="relative flex-1 md:flex-none">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                                <input className="border border-slate-200 pl-8 pr-4 py-2 rounded-xl text-xs w-full md:w-56 bg-slate-50 focus:bg-white transition-all outline-none focus:ring-2 focus:ring-indigo-100" placeholder="搜索部门 / 人名..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                            </div>
                            <button onClick={() => window.print()} className="bg-slate-100 p-2 rounded-xl hover:bg-slate-200 transition-colors shadow-sm text-sm">🖨️</button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-8">
                        {groupedDepts.map((dept: any) => {
                            const staffMembers = parseStaff(dept).filter(m => m.name);

                            return (
                            <div key={dept.id} className="rounded-3xl border border-slate-200 bg-white hover:shadow-2xl hover:border-indigo-100 transition-all group overflow-hidden">
                                
                                <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
                                    {canEdit && (
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0 duration-300 ml-auto">
                                        <button onClick={() => startEdit(dept)} className="text-[10px] font-black text-indigo-600 bg-white border border-indigo-100 px-4 py-1.5 rounded-xl hover:bg-indigo-600 hover:text-white shadow-sm transition-all active:scale-95">编辑</button>
                                        <button onClick={() => handleDelete(dept.rawIds, dept.name)} className="text-[10px] font-black text-rose-600 bg-white border border-rose-100 px-4 py-1.5 rounded-xl hover:bg-rose-600 hover:text-white shadow-sm transition-all active:scale-95">删除</button>
                                    </div>
                                    )}
                                </div>

                                <div className="px-6 py-5 flex gap-5 items-start">
                                    {/* 部门名称 - 蓝底白字，醒目大字 */}
                                    <div className="flex-shrink-0">
                                        <div className="bg-indigo-600 text-white px-5 py-4 rounded-2xl text-center shadow-lg flex flex-col items-center gap-1.5 min-w-[110px]">
                                            <span className="text-[9px] font-black opacity-60 tracking-[0.25em] uppercase">部门</span>
                                            <span className="font-black text-lg leading-tight tracking-tight">{dept.name}</span>
                                            <span className="text-[8px] opacity-50 font-black tracking-widest uppercase">{dept.name.toUpperCase().substring(0, 8)}</span>
                                        </div>
                                    </div>

                                    {/* 负责人区域 - 紧凑横排 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="mb-3 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
                                            <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">负责人</h5>
                                        </div>
                                        <div className="bg-gradient-to-br from-amber-50 to-orange-50/30 px-5 py-4 rounded-2xl border border-amber-100/50 shadow-inner flex items-center gap-5 flex-wrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-sm shadow-sm border border-amber-100">👤</div>
                                                <div>
                                                    <p className="text-base font-black text-slate-800 leading-tight">{dept.head || '暂无指派'}</p>
                                                    <span className="text-[11px] text-amber-700 font-black">{dept.head_post || '行政专员'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 pl-4 border-l border-amber-200/40">
                                                <span className="text-xs">📱</span>
                                                <span className="text-[13px] text-amber-900/60 font-mono font-black">{dept.head_phone || '未记录'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 经办人区域 */}
                                {(staffMembers.length > 0 || canEdit) && (
                                <div className="px-6 pb-5">
                                    <div className="mb-3 flex items-center gap-2 border-t border-slate-100 pt-4">
                                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                                        <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">经办人 {staffMembers.length > 0 ? `(${staffMembers.length}人)` : ''}</h5>
                                    </div>
                                    {staffMembers.length > 0 ? (
                                        <div className="flex flex-wrap gap-3">
                                            {staffMembers.map((sm, idx) => (
                                                <div key={idx} className="bg-slate-50/80 px-4 py-3 rounded-xl border border-slate-100 flex items-center gap-4 hover:bg-white hover:border-emerald-200 hover:shadow-md transition-all duration-300 group/card">
                                                    <span className="font-black text-slate-800 text-sm">{sm.name}</span>
                                                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md font-black">
                                                        {sm.post || '业务员'}
                                                    </span>
                                                    <span className="text-[13px] text-slate-400 font-mono font-bold">{sm.phone || '—'}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-[9px] text-slate-300 font-black uppercase tracking-widest italic">尚未分配经办人</div>
                                    )}
                                </div>
                                )}
                            </div>
                        )})}
                    </div>
                </div>
            </div>

            {/* Print View Optimized for Roles */}
            <div className="hidden print:block p-12">
                <h1 className="text-3xl font-black text-center mb-12 text-slate-900 border-b-8 border-slate-900 pb-6 tracking-tighter">海露集团职能部门通讯录 (2026 核定版本)</h1>
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-900 text-white text-[10px] uppercase font-black tracking-widest text-center">
                            <th className="p-5 border border-slate-900">部门名称</th>
                            <th className="p-5 border border-slate-900">负责人 (岗位)</th>
                            <th className="p-5 border border-slate-900">负责人电话</th>
                            <th className="p-5 border border-slate-900">经办人明细汇总 (姓名/岗位/联系电话)</th>
                        </tr>
                    </thead>
                    <tbody className="text-xs text-center">
                        {groupedDepts.map((d: any) => {
                            const sm = parseStaff(d).filter(m => m.name);
                            return (
                                <tr key={d.id} className="border border-slate-300">
                                    <td className="p-5 font-black text-slate-900 text-lg border border-slate-300 bg-slate-50/30">{d.name}</td>
                                    <td className="p-5 border border-slate-300">
                                        <p className="font-black text-base">{d.head}</p>
                                        <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">({d.head_post || '行政专员'})</p>
                                    </td>
                                    <td className="p-5 font-mono font-black text-slate-700 border border-slate-300 text-base">{d.head_phone}</td>
                                    <td className="p-5 border border-slate-300 text-left">
                                        <div className="grid grid-cols-1 gap-2">
                                            {sm.map((m, i) => (
                                                <div key={i} className="flex gap-4 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                                    <span className="font-black w-16 text-slate-800">{m.name}</span>
                                                    <span className="text-[9px] font-black text-slate-400 w-20 px-2 border-x border-slate-200 text-center uppercase tracking-tighter">{m.post || '业务专员'}</span>
                                                    <span className="font-mono text-[10px] font-bold text-slate-600 ml-auto">{m.phone}</span>
                                                </div>
                                            ))}
                                            {sm.length === 0 && <span className="text-slate-300 italic">空缺</span>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div className="mt-10 text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center">Generated by SC-EMS Global Infrastructure</div>
            </div>
        </div>
    );
}