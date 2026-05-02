import React, { useState } from 'react';
import TaxInvoiceManager from './TaxInvoiceManager';

export default function FinancialManager({ permissionLevel = 'edit', currentUser }: { permissionLevel?: string, currentUser?: any }) {
    const [activeSubTab, setActiveSubTab] = useState('invoices');

    const SUB_TABS = [
        { id: 'invoices', label: '发票明细', icon: '🧾' },
        { id: 'contracts', label: '合同管理', icon: '📝' },
        { id: 'expenses', label: '贸易费用', icon: '💸' },
    ];

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Sub-navigation Module Headers */}
            <div className="bg-white border-b border-slate-200 px-8 py-4 flex items-center gap-4 sticky top-16 z-40 shadow-sm">
                <span className="text-[10px] uppercase tracking-widest font-black text-slate-400 mr-4">Financial Modules</span>
                {SUB_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id)}
                        className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                            activeSubTab === tab.id 
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105' 
                                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200'
                        }`}
                    >
                        <span>{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1">
                {activeSubTab === 'invoices' && (
                    <TaxInvoiceManager permissionLevel={permissionLevel} currentUser={currentUser} />
                )}
                
                {activeSubTab === 'contracts' && (
                    <div className="flex flex-col items-center justify-center p-32 text-slate-300">
                        <div className="text-6xl mb-6">🚧</div>
                        <h2 className="text-2xl font-black text-slate-400 mb-2">合同管理模块</h2>
                        <p className="font-bold text-slate-400">该功能模块正在由开发团队紧张搭建中，敬请期待...</p>
                    </div>
                )}

                {activeSubTab === 'expenses' && (
                    <div className="flex flex-col items-center justify-center p-32 text-slate-300">
                        <div className="text-6xl mb-6">🚧</div>
                        <h2 className="text-2xl font-black text-slate-400 mb-2">贸易费用模块</h2>
                        <p className="font-bold text-slate-400">该功能模块设计开发中，即将上线...</p>
                    </div>
                )}
            </div>
        </div>
    );
}
