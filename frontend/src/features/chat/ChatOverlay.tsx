import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { chatService } from '../../services/chatService';
import type { ChatMessage } from '../../services/chatService';

interface ChatOverlayProps {
  currentUser: any;
  tradeId?: string | null;
  receiverId?: string | null;
  onClose: () => void;
}

const ChatOverlay: React.FC<ChatOverlayProps> = ({ currentUser, tradeId, receiverId: initialReceiverId, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialReceiverId || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  // 贸易单据自动关联逻辑
  useEffect(() => {
    if (tradeId) {
        autoConnectTradeParties();
    }
  }, [tradeId]);

  useEffect(() => {
    fetchMessages();
    
    const subscription = supabase
      .channel('chat_messages')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages',
        filter: tradeId ? `trade_id=eq.${tradeId}` : undefined
      }, (payload) => {
        const newMessage = payload.new as ChatMessage;
        if (newMessage.sender_id === currentUser.id) return;
        
        const isTargeted = tradeId 
            ? newMessage.trade_id === tradeId 
            : (currentUser.role === 'admin' || newMessage.receiver_id === currentUser.id || newMessage.sender_id === currentUser.id);

        if (isTargeted) {
            if (!tradeId && selectedUserId && newMessage.sender_id !== selectedUserId) return;
            setMessages(prev => [...prev, newMessage]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [tradeId, selectedUserId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 监听搜索输入
  useEffect(() => {
    const handler = setTimeout(() => {
        if (userSearchTerm.trim()) {
            handleDeepSearch();
        } else {
            setSearchResults([]);
        }
    }, 500);
    return () => clearTimeout(handler);
  }, [userSearchTerm]);

  const autoConnectTradeParties = async () => {
    // 获取贸易单据信息
    const { data: trade } = await supabase
        .from('invoices')
        .select('id, client_id, creator_id')
        .eq('id', tradeId)
        .single();
    
    if (trade) {
        // 找到该客户对应的所有用户账号
        const { data: clientUsers } = await supabase
            .from('app_users')
            .select('id')
            .eq('client_id', trade.client_id);
        
        if (clientUsers) {
            for (const cUser of clientUsers) {
                // 如果当前用户是内部人员，与该客户所有账号建立连接
                // 如果当前用户是该客户，与单据创建者（内部人员）建立连接
                if (currentUser.role !== 'client') {
                    await chatService.ensureConnection(currentUser.id, cUser.id);
                } else if (currentUser.client_id === trade.client_id) {
                    await chatService.ensureConnection(currentUser.id, trade.creator_id);
                }
            }
        }
    }
  };

  const fetchData = async () => {
    const { data: accepted } = await chatService.getAcceptedContacts(currentUser.id);
    if (accepted) setContacts(accepted);

    const { data: pending } = await chatService.getPendingRequests(currentUser.id);
    if (pending) setPendingRequests(pending);

    const { data: all } = await chatService.getAllUsers();
    if (all) setAllUsers(all.filter(u => u.id !== currentUser.id));
  };

  const handleDeepSearch = async () => {
    setSearching(true);
    const { data } = await chatService.searchGlobalEntities(userSearchTerm);
    if (data) {
        setSearchResults(data.filter(u => u.id !== currentUser.id));
    }
    setSearching(false);
  };

  const fetchMessages = async () => {
    setLoading(true);
    let result;
    if (tradeId) {
      result = await chatService.getTradeMessages(tradeId);
    } else if (selectedUserId) {
      result = await chatService.getMessagesWithUser(currentUser.id, selectedUserId);
    } else if (currentUser.role === 'admin') {
      result = await chatService.getAllMessages(currentUser.id, currentUser.role);
    }

    if (result?.data) {
      setMessages(result.data as any);
    } else {
      setMessages([]);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    if (!tradeId && !selectedUserId) {
        alert('请先选择一个联系人');
        return;
    }

    const dbMsg = {
      sender_id: currentUser.id,
      receiver_id: tradeId ? null : selectedUserId,
      trade_id: tradeId || null,
      content: inputValue.trim(),
    };

    const tempId = 'temp-' + Date.now();
    const optimisticMsg: ChatMessage = {
        ...dbMsg,
        id: tempId,
        created_at: new Date().toISOString(),
        is_read: false,
        sender_name: currentUser.full_name || currentUser.username
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInputValue('');

    const { error, data } = await chatService.sendMessage(dbMsg);
    if (error) {
      alert('发送失败: ' + error.message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } else if (data && data.length > 0) {
      setMessages(prev => prev.map(m => m.id === tempId ? data[0] : m));
    }
  };

  const handleAddRequest = async (targetId: string) => {
    const { error } = await chatService.sendConnectionRequest(currentUser.id, targetId);
    if (error) alert('申请失败: ' + error.message);
    else {
        alert('已向对方发起业务协同申请');
        setIsAddModalOpen(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    const { error } = await chatService.acceptRequest(requestId);
    if (error) alert('处理失败: ' + error.message);
    else {
        fetchData();
        alert('已确认协同关系');
    }
  };

  const filteredContacts = useMemo(() => {
    const baseList = currentUser.role === 'admin' ? allUsers : contacts;
    return baseList.filter(u => 
        (u.full_name || u.username || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [contacts, allUsers, searchTerm, currentUser.role]);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-6xl h-[85vh] rounded-[3rem] shadow-2xl flex overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300 relative">
        
        {/* Left Sidebar: Contacts */}
        {!tradeId && (
        <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50">
            <div className="p-6 border-b border-slate-100 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="font-black text-slate-800 tracking-tight">业务协同中心</h3>
                    <button 
                        onClick={() => {
                            setIsAddModalOpen(true);
                            setSearchResults([]);
                            setUserSearchTerm('');
                        }}
                        className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-90"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                    </button>
                </div>
                <div className="relative">
                    <input 
                        type="text" 
                        placeholder="搜索我的联系人..." 
                        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {pendingRequests.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest ml-1">待确认申请 ({pendingRequests.length})</p>
                        {pendingRequests.map(req => (
                            <div key={req.id} className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm flex items-center justify-between animate-pulse">
                                <div className="overflow-hidden">
                                    <p className="font-bold text-xs text-slate-800 truncate">{req.requester?.full_name}</p>
                                    <p className="text-[8px] text-amber-600 font-bold">新业务申请</p>
                                </div>
                                <button onClick={() => handleAcceptRequest(req.id)} className="bg-amber-500 text-white text-[10px] px-3 py-1.5 rounded-xl font-black hover:bg-amber-600 transition-colors">接受</button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-3">
                        {currentUser.role === 'admin' ? '全集团名单' : '我的业务伙伴'}
                    </p>
                    {filteredContacts.length === 0 ? (
                        <div className="text-center py-10 px-4">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl grayscale opacity-20">📇</div>
                            <p className="text-xs text-slate-400 font-bold">暂无往来联系人</p>
                            <button onClick={() => setIsAddModalOpen(true)} className="text-[10px] text-indigo-600 font-black mt-3 hover:underline">点击查找新客商</button>
                        </div>
                    ) : (
                        filteredContacts.map(u => (
                            <div 
                                key={u.id}
                                onClick={() => setSelectedUserId(u.id)}
                                className={`p-4 rounded-[1.5rem] cursor-pointer transition-all flex items-center gap-4 ${selectedUserId === u.id ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'hover:bg-white hover:shadow-sm text-slate-600'}`}
                            >
                                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm ${selectedUserId === u.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                    {(u.full_name || u.username || 'U').substring(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="font-bold text-sm truncate">{u.full_name || u.username}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${u.role === 'client' ? 'bg-emerald-400' : 'bg-blue-400'}`}></span>
                                        <p className={`text-[9px] uppercase tracking-tighter font-black opacity-60 ${selectedUserId === u.id ? 'text-indigo-100' : 'text-slate-400'}`}>
                                            {u.role === 'client' ? '外部客商' : '内部团队'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
        )}

        {/* Right Pane: Chat Window */}
        <div className="flex-1 flex flex-col bg-white">
            {/* Header */}
            <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-white">
                <div className="flex items-center gap-5">
                    {tradeId ? (
                        <div className="w-16 h-16 bg-amber-50 rounded-[1.5rem] flex items-center justify-center text-3xl border border-amber-100">📦</div>
                    ) : selectedUserId ? (
                        <div className="w-16 h-16 bg-indigo-50 rounded-[1.5rem] flex items-center justify-center text-indigo-600 font-black text-2xl border border-indigo-100">
                            {allUsers.find(u => u.id === selectedUserId)?.full_name?.substring(0, 1).toUpperCase() || '?'}
                        </div>
                    ) : (
                        <div className="w-16 h-16 bg-slate-50 rounded-[1.5rem] flex items-center justify-center text-3xl grayscale">🏢</div>
                    )}
                    <div>
                        <h3 className="font-black text-slate-900 text-2xl flex items-center gap-3">
                            {tradeId ? '业务单据流转协同' : selectedUserId ? (allUsers.find(u => u.id === selectedUserId)?.full_name || '对话中心') : '全局业务通讯监控'}
                            {currentUser.role === 'admin' && !tradeId && !selectedUserId && (
                                <span className="text-[11px] bg-indigo-600 text-white px-3 py-1 rounded-full font-black shadow-lg shadow-indigo-100">系统最高监管模式</span>
                            )}
                        </h3>
                        <p className="text-[12px] text-slate-400 uppercase tracking-widest font-black mt-1">
                            {tradeId ? '数字化协作通道' : selectedUserId ? '已通过安全网关加密' : '海露集团全域数据链路'}
                        </p>
                    </div>
                </div>
                <button onClick={onClose} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all font-black text-xl">✕</button>
            </div>

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-12 space-y-10 bg-slate-50/20">
                {loading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-indigo-600"></div>
                    </div>
                ) : !selectedUserId && !tradeId && currentUser.role !== 'admin' ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-8">
                        <div className="w-32 h-32 bg-white rounded-[3rem] shadow-xl border border-slate-50 flex items-center justify-center text-5xl animate-bounce">👋</div>
                        <div className="text-center">
                            <p className="text-2xl font-black text-slate-300">请选择左侧伙伴开启业务协同</p>
                            <p className="text-sm text-slate-400 font-bold mt-2">海露 SC-EMS · 每一条信息都有业务价值</p>
                        </div>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-4">
                        <div className="w-24 h-24 bg-indigo-50/50 rounded-full flex items-center justify-center text-4xl opacity-50">✍️</div>
                        <p className="text-base font-black">暂无协同记录，开始第一条对话吧</p>
                    </div>
                ) : (
                    messages.map((msg, i) => {
                        const isMe = msg.sender_id === currentUser.id;
                        return (
                            <div key={msg.id || i} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-8 duration-700`}>
                                <div className={`max-w-[80%] group`}>
                                    {!isMe && (
                                        <p className="text-[11px] font-black mb-3 ml-2 text-slate-500 uppercase flex items-center gap-2.5">
                                            <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full shadow-md"></span>
                                            {(msg as any).sender?.full_name || msg.sender_name || '协助人员'}
                                        </p>
                                    )}
                                    <div className={`rounded-[2.5rem] px-8 py-5 shadow-sm border transition-all hover:shadow-2xl ${
                                        isMe ? 'bg-gradient-to-br from-indigo-600 to-indigo-800 text-white border-indigo-500 rounded-tr-none' : 'bg-white text-slate-800 border-slate-100 rounded-tl-none'
                                    }`}>
                                        <p className="text-[16px] leading-relaxed whitespace-pre-wrap font-medium">{msg.content}</p>
                                    </div>
                                    <p className={`text-[10px] mt-4 opacity-0 group-hover:opacity-100 transition-opacity font-mono font-black text-slate-400 ${isMe ? 'text-right pr-4' : 'text-left pl-4'}`}>
                                        {new Date(msg.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input Area */}
            <div className="p-10 bg-white border-t border-slate-50">
                <div className="relative flex items-center gap-6 max-w-5xl mx-auto">
                    <textarea
                        rows={1}
                        className="flex-1 bg-slate-50 border border-slate-100 rounded-[2rem] px-10 py-6 text-[16px] focus:ring-8 focus:ring-indigo-600/5 focus:bg-white focus:border-indigo-600 outline-none transition-all resize-none scrollbar-none shadow-inner font-medium"
                        placeholder={tradeId ? "在此回复或确认业务状态..." : selectedUserId ? "输入协同信息..." : "请从左侧选择一个对话..."}
                        value={inputValue}
                        disabled={!tradeId && !selectedUserId}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <button 
                        onClick={handleSend}
                        disabled={!inputValue.trim() || (!tradeId && !selectedUserId)}
                        className="bg-indigo-600 text-white w-20 h-20 rounded-[2rem] flex items-center justify-center hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed shadow-2xl shadow-indigo-200 transition-all active:scale-90 group"
                    >
                        <svg className="w-8 h-8 transform rotate-90 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        {/* Add Contact Modal (Enhanced Search) */}
        {isAddModalOpen && (
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl z-[110] flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-2xl rounded-[3.5rem] shadow-2xl p-12 animate-in zoom-in-95 duration-200 border border-white/20">
                    <div className="flex justify-between items-center mb-10">
                        <div>
                            <h4 className="text-2xl font-black text-slate-800">建立业务合作伙伴关系</h4>
                            <p className="text-xs text-slate-400 font-bold mt-1 uppercase tracking-widest">通过企业名称或纳税号精准搜索</p>
                        </div>
                        <button onClick={() => setIsAddModalOpen(false)} className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-600 font-black">✕</button>
                    </div>
                    <div className="space-y-6">
                        <div className="relative">
                            <input 
                                type="text" 
                                placeholder="输入对方公司全称 / 纳税识别号 (Tax ID) / 姓名..." 
                                className="w-full bg-slate-50 border border-slate-100 rounded-3xl px-8 py-5 text-base focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-inner font-bold"
                                value={userSearchTerm}
                                onChange={e => setUserSearchTerm(e.target.value)}
                                autoFocus
                            />
                            {searching && (
                                <div className="absolute right-6 top-5">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                                </div>
                            )}
                        </div>
                        
                        <div className="max-h-[350px] overflow-y-auto space-y-3 pr-3 scrollbar-thin">
                            {searchResults.length === 0 ? (
                                <div className="text-center py-20 px-10">
                                    <div className="text-5xl grayscale opacity-10 mb-4">🔍</div>
                                    <p className="text-slate-400 text-sm font-bold">请在上方输入完整的关键词进行搜索</p>
                                    <p className="text-[10px] text-slate-300 mt-2">支持搜索“正园农业”或相关的纳税号</p>
                                </div>
                            ) : (
                                searchResults.map(u => (
                                    <div key={u.id} className="flex items-center justify-between p-6 bg-white rounded-[2rem] border border-slate-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/5 transition-all group">
                                        <div className="flex items-center gap-5">
                                            <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                                {u.full_name?.substring(0, 1).toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-black text-lg text-slate-800">{u.full_name}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${u.role === 'client' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                                        {u.role === 'client' ? '企业客商' : '集团团队'}
                                                    </span>
                                                    {u.client_id && <span className="text-[9px] text-slate-400 font-mono">ID: {u.client_id}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleAddRequest(u.id)}
                                            className="bg-indigo-600 text-white text-[13px] font-black px-6 py-3 rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
                                        >申请建立连接</button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mt-10 p-5 bg-indigo-50/50 rounded-3xl border border-indigo-100/50">
                        <div className="text-xl">🛡️</div>
                        <p className="text-[11px] text-indigo-900 leading-snug font-bold">
                            为了保障贸易安全，系统将通过纳税识别号进行企业背书验证。连接成功后，对方将出现在您的“业务伙伴”名单中。
                        </p>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default ChatOverlay;
