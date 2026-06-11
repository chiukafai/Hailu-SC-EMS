import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { chatService } from '../../services/chatService';
import type { ChatMessage, Conversation } from '../../services/chatService';

interface ChatOverlayProps {
  currentUser: any;
  tradeId?: string | null;
  receiverId?: string | null;
  onClose: () => void;
}

type TabType = 'conversations' | 'directory' | 'external' | 'requests';

const ChatOverlay: React.FC<ChatOverlayProps> = ({ currentUser, tradeId, receiverId: initialReceiverId, onClose }) => {
  // ========== 状态管理 ==========
  const [activeTab, setActiveTab] = useState<TabType>('conversations');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  
  // 内部通信录（按部门分组）
  const [internalGrouped, setInternalGrouped] = useState<{ [key: string]: any[] }>({});
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  
  // 外部联系人
  const [externalContacts, setExternalContacts] = useState<any[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  
  // 搜索
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [convSearchTerm, setConvSearchTerm] = useState('');
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // ========== 数据获取 ==========
  
  // 获取会话列表
  const fetchConversations = async () => {
    setLoadingConversations(true);
    const { data, error } = await chatService.getConversations(currentUser.id);
    if (data) {
      setConversations(data);
    }
    setLoadingConversations(false);
  };

  // 获取消息
  const fetchMessages = async () => {
    if (!selectedConv) return;
    setLoading(true);
    const { data, error } = await chatService.getMessagesWithUser(currentUser.id, selectedConv.other_user_id);
    if (data) {
      setMessages(data);
    }
    setLoading(false);
    
    // 标记已读
    await chatService.markAsRead(currentUser.id, selectedConv.other_user_id);
  };

  // 获取待处理申请
  const fetchPendingRequests = async () => {
    const { data } = await chatService.getPendingRequests(currentUser.id);
    if (data) {
      setPendingRequests(data);
    }
  };

  // 获取内部通信录（按部门分组）
  const fetchInternalDirectory = async () => {
    setLoadingDirectory(true);
    const { data, error } = await chatService.getInternalContactsGrouped(currentUser.id);
    if (data) {
      setInternalGrouped(data);
    }
    setLoadingDirectory(false);
  };

  // 获取外部联系人
  const fetchExternalContacts = async () => {
    setLoadingExternal(true);
    const { data, error } = await chatService.getExternalContacts(currentUser.id);
    if (data) {
      setExternalContacts(data);
    }
    setLoadingExternal(false);
  };

  // ========== 副作用 ==========
  
  // 初始加载
  useEffect(() => {
    fetchConversations();
    fetchPendingRequests();
  }, []);

  // 切换标签页
  useEffect(() => {
    if (activeTab === 'directory') {
      fetchInternalDirectory();
    } else if (activeTab === 'external') {
      fetchExternalContacts();
    } else if (activeTab === 'requests') {
      fetchPendingRequests();
    }
  }, [activeTab]);

  // 选择会话后获取消息
  useEffect(() => {
    if (selectedConv) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [selectedConv]);

  // 实时订阅新消息
  useEffect(() => {
    const channel = supabase
      .channel('chat_messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages'
      }, (payload) => {
        const newMessage = payload.new as ChatMessage;
        
        // 如果当前正在查看该会话，添加到消息列表
        if (selectedConv && (newMessage.sender_id === selectedConv.other_user_id || newMessage.sender_id === currentUser.id)) {
          setMessages(prev => [...prev, newMessage]);
          // 标记已读
          if (newMessage.sender_id !== currentUser.id) {
            chatService.markAsRead(currentUser.id, newMessage.sender_id);
          }
        }
        
        // 刷新会话列表
        fetchConversations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConv]);

  // 滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 搜索用户（防抖）
  useEffect(() => {
    const handler = setTimeout(() => {
      if (userSearchTerm.trim()) {
        handleSearch();
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [userSearchTerm]);

  // ========== 事件处理 ==========
  
  // 搜索用户
  const handleSearch = async () => {
    setSearching(true);
    const { data } = await chatService.searchGlobalEntities(userSearchTerm);
    if (data) {
      // 过滤掉自己
      const filtered = data.filter(u => u.id !== currentUser.id);
      setSearchResults(filtered);
    }
    setSearching(false);
  };

  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim() || !selectedConv) return;

    const msg = {
      sender_id: currentUser.id,
      receiver_id: selectedConv.other_user_id,
      content: inputValue.trim(),
      is_read: false
    };

    // 乐观更新
    const tempId = 'temp-' + Date.now();
    const optimisticMsg: ChatMessage = {
      ...msg,
      id: tempId,
      created_at: new Date().toISOString(),
      sender_name: currentUser.full_name
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInputValue('');

    const { error, data } = await chatService.sendMessage(msg);
    if (error) {
      alert('发送失败: ' + error.message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } else if (data && data.length > 0) {
      setMessages(prev => prev.map(m => m.id === tempId ? data[0] : m));
      // 刷新会话列表
      fetchConversations();
    }
  };

  // 发送好友申请
  const handleAddRequest = async (targetId: string) => {
    const { error } = await chatService.sendConnectionRequest(currentUser.id, targetId);
    if (error) {
      alert('申请失败: ' + error.message);
    } else {
      alert('已发送好友申请');
      setIsAddModalOpen(false);
      setUserSearchTerm('');
      setSearchResults([]);
    }
  };

  // 接受好友申请
  const handleAcceptRequest = async (requestId: string) => {
    const { error } = await chatService.acceptRequest(requestId);
    if (error) {
      alert('处理失败: ' + error.message);
    } else {
      fetchPendingRequests();
      fetchConversations();
    }
  };

  // 拒绝好友申请
  const handleRejectRequest = async (requestId: string) => {
    const { error } = await chatService.rejectRequest(requestId);
    if (error) {
      alert('处理失败: ' + error.message);
    } else {
      fetchPendingRequests();
    }
  };

  // 启动聊天（检查是否可以直接聊天）
  const handleStartChat = async (otherUser: any) => {
    const otherId = otherUser.id;
    
    // 检查是否可以直接聊天
    const { canChat, reason } = await chatService.canChatDirectly(currentUser.id, otherId);
    
    if (canChat) {
      // 可以直接聊天，创建或切换到会话
      const newConv: Conversation = {
        id: otherId,
        other_user_id: otherId,
        other_user_name: otherUser.full_name || otherUser.username,
        other_user_role: otherUser.role,
        last_message: '',
        last_message_time: new Date().toISOString(),
        unread_count: 0
      };
      setSelectedConv(newConv);
      setActiveTab('conversations');
    } else {
      // 需要好友申请
      const { error } = await chatService.sendConnectionRequest(currentUser.id, otherId);
      if (error) {
        alert('无法发起聊天: ' + error.message);
      } else {
        alert('已发送好友申请，请等待对方接受');
      }
    }
  };

  // ========== 工具函数 ==========
  
  // 格式化时间
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // 过滤会话列表
  const filteredConversations = useMemo(() => {
    if (!convSearchTerm.trim()) return conversations;
    return conversations.filter(conv => 
      conv.other_user_name?.toLowerCase().includes(convSearchTerm.toLowerCase())
    );
  }, [conversations, convSearchTerm]);

  // ========== 渲染 ==========
  
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-6xl h-[85vh] rounded-[3rem] shadow-2xl flex overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300 relative">
        
        {/* ========== 左侧：标签页 + 内容 ========== */}
        <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50">
          {/* 头部：用户信息 */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-sm">
                {currentUser?.full_name?.substring(0, 1).toUpperCase() || '?'}
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-sm">{currentUser?.full_name || '用户'}</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                  {currentUser?.role === 'admin' ? '管理员' : currentUser?.role === 'client' ? '客户' : '员工'}
                </p>
              </div>
            </div>
            
            {/* 搜索栏（仅在会话标签页显示） */}
            {activeTab === 'conversations' && (
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="搜索会话..." 
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                  value={convSearchTerm}
                  onChange={e => setConvSearchTerm(e.target.value)}
                />
              </div>
            )}
          </div>
          
          {/* 标签页导航 */}
          <div className="flex border-b border-slate-100">
            <button 
              onClick={() => setActiveTab('conversations')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === 'conversations' 
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                </svg>
                <span>会话</span>
              </div>
            </button>
            
            <button 
              onClick={() => setActiveTab('directory')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === 'directory' 
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                </svg>
                <span>通信录</span>
              </div>
            </button>
            
            <button 
              onClick={() => setActiveTab('external')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === 'external' 
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-1 relative">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m0 18v-9m0 9c1.657 0 3-4.03 3-9s-1.343-9-3-9"></path>
                </svg>
                <span>外部</span>
              </div>
            </button>
            
            <button 
              onClick={() => setActiveTab('requests')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all relative ${
                activeTab === 'requests' 
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' 
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <span>申请</span>
                {pendingRequests.length > 0 && (
                  <span className="absolute top-1 right-2 w-5 h-5 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                    {pendingRequests.length}
                  </span>
                )}
              </div>
            </button>
          </div>
          
          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto">
            {/* 会话列表 */}
            {activeTab === 'conversations' && (
              loadingConversations ? (
                <div className="flex justify-center items-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl grayscale opacity-20">
                    💬
                  </div>
                  <p className="text-xs text-slate-400 font-bold">暂无对话</p>
                  <p className="text-[9px] text-slate-300 mt-1">点击通信录发起聊天</p>
                </div>
              ) : (
                filteredConversations.map(conv => (
                  <div 
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    className={`p-4 cursor-pointer transition-all flex items-center gap-3 hover:bg-white ${
                      selectedConv?.id === conv.id ? 'bg-white shadow-sm' : ''
                    }`}
                  >
                    {/* 头像 */}
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm ${
                      selectedConv?.id === conv.id ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {conv.other_user_name?.substring(0, 1).toUpperCase() || '?'}
                    </div>
                    
                    {/* 内容 */}
                    <div className="flex-1 overflow-hidden">
                      <div className="flex justify-between items-center mb-1">
                        <p className="font-bold text-sm truncate">{conv.other_user_name}</p>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatTime(conv.last_message_time)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-slate-500 truncate pr-2">{conv.last_message}</p>
                        {conv.unread_count > 0 && (
                          <span className="bg-rose-500 text-white text-[10px] font-black rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                            {conv.unread_count > 99 ? '99+' : conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )
            )}
            
            {/* 内部通信录（按部门分组） */}
            {activeTab === 'directory' && (
              loadingDirectory ? (
                <div className="flex justify-center items-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : (
                <div>
                  {Object.entries(internalGrouped).map(([deptName, users]) => (
                    <div key={deptName}>
                      {/* 部门标题 */}
                      <div className="px-4 py-2 bg-slate-100/50">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {deptName} ({users.length})
                        </p>
                      </div>
                      {/* 部门员工 */}
                      {users.map(user => (
                        <div 
                          key={user.id}
                          onClick={() => handleStartChat(user)}
                          className="p-4 cursor-pointer transition-all flex items-center gap-3 hover:bg-white"
                        >
                          <div className="w-10 h-10 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center font-black text-sm">
                            {(user.full_name || user.username)?.substring(0, 1).toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <p className="font-bold text-sm truncate">{user.full_name || user.username}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {user.department_id ? '部门员工' : '集团架构'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )
            )}
            
            {/* 外部联系人 */}
            {activeTab === 'external' && (
              loadingExternal ? (
                <div className="flex justify-center items-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : externalContacts.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <p className="text-xs text-slate-400 font-bold">暂无外部联系人</p>
                </div>
              ) : (
                externalContacts.map(contact => (
                  <div 
                    key={contact.id}
                    onClick={() => handleStartChat(contact)}
                    className="p-4 cursor-pointer transition-all flex items-center gap-3 hover:bg-white"
                  >
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm ${
                      contact.is_friend ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {(contact.full_name || contact.username)?.substring(0, 1).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-bold text-sm truncate">{contact.full_name || contact.username}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {contact.is_friend ? '已添加' : '未添加'}
                      </p>
                    </div>
                  </div>
                ))
              )
            )}
            
            {/* 好友申请 */}
            {activeTab === 'requests' && (
              pendingRequests.length === 0 ? (
                <div className="text-center py-20 px-4">
                  <p className="text-xs text-slate-400 font-bold">暂无待处理申请</p>
                </div>
              ) : (
                pendingRequests.map(req => (
                  <div key={req.id} className="p-4 bg-white border-b border-slate-50">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center font-black text-sm">
                        {req.requester?.full_name?.substring(0, 1).toUpperCase() || '?'}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-sm">{req.requester?.full_name || '未知用户'}</p>
                        <p className="text-[10px] text-slate-400">申请添加您为好友</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleAcceptRequest(req.id)}
                        className="flex-1 bg-indigo-600 text-white text-xs font-bold py-2 rounded-xl hover:bg-indigo-700 transition-all"
                      >
                        接受
                      </button>
                      <button 
                        onClick={() => handleRejectRequest(req.id)}
                        className="flex-1 bg-slate-100 text-slate-600 text-xs font-bold py-2 rounded-xl hover:bg-slate-200 transition-all"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
          
          {/* 底部：添加好友按钮 */}
          <div className="p-4 border-t border-slate-100">
            <button 
              onClick={() => {
                setIsAddModalOpen(true);
                setSearchResults([]);
                setUserSearchTerm('');
              }}
              className="w-full bg-indigo-600 text-white py-3 rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              + 添加好友/企业
            </button>
          </div>
        </div>

        {/* ========== 右侧：聊天窗口 ========== */}
        <div className="flex-1 flex flex-col bg-white">
          {selectedConv ? (
            <>
              {/* 头部 */}
              <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-white">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 font-black">
                    {selectedConv.other_user_name?.substring(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900">{selectedConv.other_user_name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black mt-0.5">
                      在线
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all font-black text-xl">
                  ✕
                </button>
              </div>
              
              {/* 消息区域 */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/20">
                {loading ? (
                  <div className="flex justify-center items-center h-full">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-4">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-4xl opacity-50">
                      ✍️
                    </div>
                    <p className="text-base font-black">暂无消息，开始第一条对话吧</p>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const isMe = msg.sender_id === currentUser.id;
                    return (
                      <div key={msg.id || i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] ${isMe ? 'order-2' : 'order-1'}`}>
                          {!isMe && (
                            <p className="text-[11px] font-bold mb-2 ml-2 text-slate-500">
                              {msg.sender_name || selectedConv.other_user_name}
                            </p>
                          )}
                          <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                            isMe 
                              ? 'bg-indigo-600 text-white rounded-br-none' 
                              : 'bg-white text-slate-800 rounded-bl-none'
                          }`}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          </div>
                          <p className={`text-[10px] mt-1 font-mono text-slate-400 ${isMe ? 'text-right mr-2' : 'text-left ml-2'}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* 输入区域 */}
              <div className="p-6 bg-white border-t border-slate-50">
                <div className="flex items-center gap-4">
                  <textarea
                    rows={1}
                    className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:bg-white focus:border-indigo-500 outline-none transition-all resize-none"
                    placeholder="输入消息..."
                    value={inputValue}
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
                    disabled={!inputValue.trim()}
                    className="bg-indigo-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed shadow-lg shadow-indigo-200 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5 transform rotate-90" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </>
          ) : (
            // 未选择会话
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-6">
              <div className="w-32 h-32 bg-slate-50 rounded-full flex items-center justify-center text-5xl animate-bounce">
                👋
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-slate-300">选择联系人开始聊天</p>
                <p className="text-sm text-slate-400 font-bold mt-2">海露 SC-EMS · 即时通讯</p>
              </div>
            </div>
          )}
        </div>

        {/* ========== 添加好友模态框 ========== */}
        {isAddModalOpen && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl z-[110] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-[3.5rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200 border border-white/20">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h4 className="text-2xl font-black text-slate-800">添加好友/企业</h4>
                  <p className="text-xs text-slate-400 font-bold mt-1 uppercase tracking-widest">搜索用户或企业</p>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="w-10 h-10 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-600 font-black">
                  ✕
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      placeholder="输入姓名、用户名或企业名称..." 
                      className="w-full bg-slate-50 border border-slate-100 rounded-3xl px-6 py-4 text-base focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-inner font-bold"
                      value={userSearchTerm}
                      onChange={e => setUserSearchTerm(e.target.value)}
                      autoFocus
                    />
                    {searching && (
                      <div className="absolute right-4 top-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="max-h-[350px] overflow-y-auto space-y-3 pr-3">
                  {searchResults.length === 0 ? (
                    <div className="text-center py-20 px-10">
                      <div className="text-5xl grayscale opacity-10 mb-4">🔍</div>
                      <p className="text-slate-400 text-sm font-bold">搜索用户或企业</p>
                    </div>
                  ) : (
                    searchResults.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/5 transition-all group">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            {u.full_name?.substring(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-black text-base text-slate-800">{u.full_name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${u.role === 'client' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                {u.role === 'client' ? '企业客商' : '集团团队'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleAddRequest(u.id)}
                          className="bg-indigo-600 text-white text-[13px] font-black px-6 py-3 rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
                        >
                          添加好友
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatOverlay;
