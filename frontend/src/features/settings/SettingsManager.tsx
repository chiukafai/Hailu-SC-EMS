import { useState } from 'react';
import UserManager from '../auth/UserManager';
import AssetManager from './AssetManager';
import ProductManager from '../products/ProductManager';
import LogManager from './LogManager';

export default function SettingsManager({ currentUser }: { currentUser: any }) {
    const [subTab, setSubTab] = useState<'users' | 'assets' | 'products' | 'logs'>('users');

    return (
        <div className="animate-fade-in">
            {/* Settings Sub-navigation */}
            <div className="bg-white border-b border-slate-200 sticky top-16 z-40">
                <div className="max-w-[1600px] mx-auto px-12 py-3 flex gap-4">
                    <button 
                        onClick={() => setSubTab('users')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${subTab === 'users' ? 'bg-purple-600 text-white shadow-md shadow-purple-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                    >
                        🔐 系统防御阵列监视
                    </button>
                    <button 
                        onClick={() => setSubTab('assets')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${subTab === 'assets' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                    >
                        ☁️ 影像资产中心
                    </button>
                    <button 
                        onClick={() => setSubTab('products')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${subTab === 'products' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                    >
                        📦 农产品商品库
                    </button>
                    <button 
                        onClick={() => setSubTab('logs')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${subTab === 'logs' ? 'bg-rose-600 text-white shadow-md shadow-rose-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                    >
                        📜 中枢节点审计
                    </button>
                </div>
            </div>

            <div className="py-4">
                {subTab === 'users' && <UserManager currentUser={currentUser} />}
                {subTab === 'assets' && <AssetManager />}
                {subTab === 'products' && <ProductManager permissionLevel="admin" />}
                {subTab === 'logs' && <LogManager />}
            </div>
        </div>
    );
}
