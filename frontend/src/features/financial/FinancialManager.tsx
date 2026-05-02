import { useState } from 'react';
import TaxInvoiceManager from './TaxInvoiceManager';
import ContractManager from './ContractManager';
import ExpenseManager from './ExpenseManager';

export default function FinancialManager({ permissionLevel = 'edit', currentUser }: { permissionLevel?: string, currentUser?: any }) {
    const [activeSubTab, setActiveSubTab] = useState('invoices');

    const SUB_TABS = [
        { id: 'invoices',   label: '发票明细', icon: '🧾' },
        { id: 'contracts',  label: '合同管理', icon: '📝' },
        { id: 'expenses',   label: '贸易费用', icon: '💸' },
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
                    <ContractManager permissionLevel={permissionLevel} currentUser={currentUser} />
                )}
                {activeSubTab === 'expenses' && (
                    <ExpenseManager permissionLevel={permissionLevel} currentUser={currentUser} />
                )}
            </div>
        </div>
    );
}
