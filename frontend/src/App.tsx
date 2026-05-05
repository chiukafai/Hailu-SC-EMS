import { useState, useEffect } from 'react';
import GroupDashboard from './features/dashboard/GroupDashboard';
import OrgManager from './features/organizations/OrgManager';
import ClientManager from './features/clients/ClientManager';
import ProductManager from './features/products/ProductManager';
import InvoiceManager from './features/invoices/InvoiceManager';
import DepartmentManager from './features/departments/DepartmentManager';
import FinancialManager from './features/financial/FinancialManager';
import Login from './features/auth/Login';
import SettingsManager from './features/settings/SettingsManager';
import ChatOverlay from './features/chat/ChatOverlay';

const ALL_TABS = [
  { id: 'dash', label: '集团仪表盘' },
  { id: 'org', label: '集团架构' },
  { id: 'dept', label: '部门管理' },
  { id: 'client', label: '合作客户档案' },
  { id: 'invoices', label: '业务贸易数据' },
  { id: 'financial', label: '财务数据' },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('dash');
  
  // Chat States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<{ tradeId?: string | null; receiverId?: string | null }>({});

  useEffect(() => {
    const saved = localStorage.getItem('hailu_ems_session');
    if (saved) {
      setCurrentUser(JSON.parse(saved));
    }
  }, []);

  const handleLogin = (u: any) => {
    setCurrentUser(u);
    localStorage.setItem('hailu_ems_session', JSON.stringify(u));
    // default tab for user
    if (u.role === 'admin') {
      setActiveTab('dash');
    } else {
      const allowedKeys = Object.keys(u.permissions || {});
      if (allowedKeys.length > 0) {
        setActiveTab(allowedKeys[0]);
      } else {
        setActiveTab(''); // No permissions
      }
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('hailu_ems_session');
  };

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  // Support legacy arrays or standard object
  const perms = (typeof currentUser.permissions === 'object' && !Array.isArray(currentUser.permissions)) 
        ? currentUser.permissions : {};

  // Calculate visible tabs based on strictly typed permissions
  const visibleTabs = currentUser.role === 'admin' 
    ? ALL_TABS 
    : ALL_TABS.filter(t => !!perms[t.id] || (Array.isArray(currentUser.permissions) && currentUser.permissions.includes(t.id)));

  const getPerm = (id: string) => currentUser.role === 'admin' ? 'admin' : (perms[id] || 'none');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-8 overflow-x-auto no-scrollbar">
            <span className="text-xl font-black bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent whitespace-nowrap hidden md:block">
              HAILU SC-EMS
            </span>
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
              {visibleTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {tab.label}
                </button>
              ))}
              {currentUser.role === 'admin' && (
                <button
                  onClick={() => setActiveTab('users')}
                  className={`ml-2 px-4 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap ${activeTab === 'users' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-600 hover:bg-purple-100'}`}
                >
                  🏰 系统设置
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs font-bold text-slate-700">{currentUser.username} <span className="text-slate-400 font-normal">{currentUser.role==='admin'?'(超级管理员)':currentUser.role==='client'?'(外部客商)':'(内部员工)'}</span></span>
              <span className="text-[9px] font-mono text-emerald-500 uppercase tracking-widest">Network Secure</span>
            </div>
            <button 
              onClick={() => {
                setChatContext({});
                setIsChatOpen(true);
              }}
              className="relative p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all group"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
              </svg>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 border-2 border-white rounded-full"></span>
            </button>
            <button onClick={handleLogout} className="text-xs bg-slate-100 text-slate-500 font-bold px-3 py-1.5 rounded-lg hover:bg-slate-200 hover:text-slate-800 transition-colors">安全登出</button>
          </div>
        </div>
      </nav>

    <main className="pb-8">
      {activeTab === 'dash' && <GroupDashboard currentUser={currentUser} />}
        {activeTab === 'org' && <OrgManager permissionLevel={getPerm('org')} />}
        {activeTab === 'dept' && <DepartmentManager permissionLevel={getPerm('dept')} />}
        {activeTab === 'client' && <ClientManager currentUser={currentUser} permissionLevel={getPerm('client')} />}
        {activeTab === 'invoices' && (
          <InvoiceManager 
            permissionLevel={getPerm('invoices')} 
            currentUser={currentUser} 
            onOpenChat={(tradeId: string) => {
              setChatContext({ tradeId });
              setIsChatOpen(true);
            }} 
          />
        )}
        {activeTab === 'financial' && <FinancialManager permissionLevel={getPerm('financial')} currentUser={currentUser} />}
        {activeTab === 'users' && currentUser.role === 'admin' && <SettingsManager currentUser={currentUser} />}

        {visibleTabs.length === 0 && currentUser.role !== 'admin' && activeTab === '' && (
          <div className="flex items-center justify-center p-20 text-slate-400 font-bold">
            您当前尚未被授予任何模块的访问权限，请联系管理员分配。
          </div>
        )}
      </main>

      {/* Global Chat Overlay */}
      {isChatOpen && (
        <ChatOverlay 
          currentUser={currentUser}
          tradeId={chatContext.tradeId}
          receiverId={chatContext.receiverId}
          onClose={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}