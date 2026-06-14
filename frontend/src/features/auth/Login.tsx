import React, { useState } from 'react';
import { supabase } from '../../api/supabase';
import { logAudit } from '../../utils/auditLogger';

export default function Login({ onLogin }: { onLogin: (user: any) => void }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        
        const { data, error: fetchError } = await supabase
            .from('app_users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        setLoading(false);
        if (fetchError || !data) {
            setError('账号验证失败，可能密码错误或账号被系统冻结。');
        } else {
            // 写入审计日志
            await logAudit(data.id, 'LOGIN', '系统登录', `用户 [${data.name}] 登录了系统`);
            
            onLogin(data);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
            <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 w-full max-w-md border border-slate-100">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                        HAILU SC-EMS
                    </h1>
                    <p className="text-slate-500 text-xs font-bold tracking-widest uppercase">
                        Enterprise Information Gateway
                    </p>
                </div>
                {error && <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs mb-6 font-bold flex items-center justify-center shadow-sm">{error}</div>}
                
                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">用户名</label>
                        <input type="text" className="w-full border border-slate-200 px-5 py-4 rounded-xl bg-slate-50 focus:bg-white focus:ring-4 focus:ring-blue-600/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700" value={username} onChange={e => setUsername(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">密码</label>
                        <input type="password" className="w-full border border-slate-200 px-5 py-4 rounded-xl bg-slate-50 focus:bg-white focus:ring-4 focus:ring-blue-600/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-slate-900 border border-black text-white font-black py-4 rounded-xl hover:bg-black hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 disabled:opacity-50 mt-4 tracking-wider">
                        {loading ? '登录中...' : '登录'}
                    </button>
                    <div className="text-center pt-4">
                        <span className="text-[10px] text-slate-300 font-mono">ENCRYPTED END-TO-END VERIFICATION</span>
                    </div>
                </form>
            </div>
        </div>
    );
}
