import { supabase } from './supabaseClient';

export interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  trade_id: string | null;
  content: string;
  created_at: string;
  is_read: boolean;
  sender_name?: string;
}

export interface Conversation {
  id: string;
  other_user_id: string;
  other_user_name: string;
  other_user_role: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
}

export const chatService = {
  // ========== 消息相关 ==========
  
  // 发送消息
  sendMessage: async (msg: Partial<ChatMessage>) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert([msg])
      .select();
    return { data, error };
  },

  // 获取与特定用户的聊天记录
  getMessagesWithUser: async (myId: string, otherId: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        *,
        sender:app_users!sender_id(full_name, role, client_id)
      `)
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`)
      .order('created_at', { ascending: true });
    
    // 如果接收方是客户，且发送方是内部用户，则显示"海露集团"
    const processedData = data?.map(msg => {
        const sender = (msg as any).sender;
        if (sender && sender.role === 'user') {
            return {
                ...msg,
                sender_name: '海露集团',
                _original_sender: sender
            };
        }
        return msg;
    });
    
    return { data: processedData, error };
  },

  // 标记消息为已读
  markAsRead: async (myId: string, otherId: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('sender_id', otherId)
      .eq('receiver_id', myId)
      .eq('is_read', false);
    return { data, error };
  },

  // 获取未读消息总数
  getUnreadCount: async (myId: string) => {
    const { count, error } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', myId)
      .eq('is_read', false);
    return { count: count || 0, error };
  },

  // ========== 会话列表 ==========
  
  // 获取会话列表（最近对话）
  getConversations: async (myId: string) => {
    // 获取所有与我相关的消息，按时间倒序
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select(`
        *,
        sender:app_users!sender_id(id, full_name, role),
        receiver:app_users!receiver_id(id, full_name, role)
      `)
      .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error };

    // 构建会话列表（每个对话对象只出现一次）
    const conversationsMap = new Map<string, Conversation>();
    
    messages?.forEach(msg => {
      const otherId = msg.sender_id === myId ? msg.receiver_id : msg.sender_id;
      if (!otherId) return;
      
      if (!conversationsMap.has(otherId)) {
        const otherUser = msg.sender_id === myId ? msg.receiver : msg.sender;
        conversationsMap.set(otherId, {
          id: otherId,
          other_user_id: otherId,
          other_user_name: otherUser?.full_name || '未知用户',
          other_user_role: otherUser?.role || 'user',
          last_message: msg.content,
          last_message_time: msg.created_at,
          unread_count: 0
        });
      }
    });

    // 获取未读数
    const { data: unreadMsgs } = await supabase
      .from('chat_messages')
      .select('sender_id')
      .eq('receiver_id', myId)
      .eq('is_read', false);

    // 统计每个发送者的未读数
    if (unreadMsgs) {
      const unreadCounts = new Map<string, number>();
      unreadMsgs.forEach(msg => {
        const count = unreadCounts.get(msg.sender_id) || 0;
        unreadCounts.set(msg.sender_id, count + 1);
      });

      // 更新会话列表的未读数
      unreadCounts.forEach((count, userId) => {
        const conv = conversationsMap.get(userId);
        if (conv) {
          conv.unread_count = count;
        }
      });
    }

    // 转换为数组并按最后消息时间排序
    const conversations = Array.from(conversationsMap.values())
      .sort((a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime());

    return { data: conversations, error: null };
  },

  // ========== 好友关系检查 ==========
  
  // 检查是否可以直接聊天（无需好友申请）
  canChatDirectly: async (myId: string, otherId: string) => {
    // 1. 获取双方信息
    const { data: users } = await supabase
      .from('app_users')
      .select('id, role, client_id, department_id, org_id')
      .in('id', [myId, otherId]);
    
    if (!users || users.length < 2) {
      return { canChat: false, reason: '用户不存在' };
    }
    
    const me = users.find(u => u.id === myId);
    const other = users.find(u => u.id === otherId);
    
    if (!me || !other) {
      return { canChat: false, reason: '用户不存在' };
    }
    
    // 2. 如果双方都是内部员工（role='user'），可以直接聊天（内部通信录）
    if (me.role === 'user' && other.role === 'user') {
      return { canChat: true, reason: '内部通信录' };
    }
    
    // 3. 如果涉及客户，检查是否有贸易往来
    if (other.role === 'client' || me.role === 'client') {
      const hasTrade = await chatService.checkTradeRelation(myId, otherId);
      if (hasTrade) {
        return { canChat: true, reason: '贸易伙伴' };
      }
    }
    
    // 4. 检查是否已是好友
    const { isFriend } = await chatService.checkFriendship(myId, otherId);
    if (isFriend) {
      return { canChat: true, reason: '已是好友' };
    }
    
    // 5. 其他情况需要好友关系
    return { canChat: false, reason: '需要好友关系' };
  },
  
  // 检查是否有贸易往来
  checkTradeRelation: async (userId1: string, userId2: string) => {
    // 获取两个用户的信息
    const { data: users } = await supabase
      .from('app_users')
      .select('id, role, client_id, org_id')
      .in('id', [userId1, userId2]);
    
    if (!users || users.length < 2) return false;
    
    const user1 = users.find(u => u.id === userId1);
    const user2 = users.find(u => u.id === userId2);
    
    if (!user1 || !user2) return false;
    
    // 情况1：user1 是内部用户，user2 是客户
    if (user1.role === 'user' && user2.role === 'client') {
      // 检查 invoices 表中是否有 user1 创建的、客户是 user2 的记录
      const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('created_by', userId1)
        .eq('client_tax_id', user2.client_id);
      
      return (count || 0) > 0;
    }
    
    // 情况2：user1 是客户，user2 是内部用户
    if (user1.role === 'client' && user2.role === 'user') {
      const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('created_by', userId2)
        .eq('client_tax_id', user1.client_id);
      
      return (count || 0) > 0;
    }
    
    // 情况3：双方都是客户，检查是否有共同贸易记录
    if (user1.role === 'client' && user2.role === 'client') {
      // 检查是否有发票记录关联双方
      const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .or(`and(created_by.eq.${userId1},client_tax_id.eq.${user2.client_id}),and(created_by.eq.${userId2},client_tax_id.eq.${user1.client_id})`);
      
      return (count || 0) > 0;
    }
    
    return false;
  },
  
  // 根据贸易记录自动建立好友关系
  autoCreateFriendFromTrade: async (invoiceData: any) => {
    // invoiceData 包含：created_by, client_tax_id
    const { created_by, client_tax_id } = invoiceData;
    
    if (!created_by || !client_tax_id) return;
    
    // 查找客户对应的用户账号
    const { data: clientUsers } = await supabase
      .from('app_users')
      .select('id')
      .eq('client_id', client_tax_id);
    
    if (!clientUsers || clientUsers.length === 0) return;
    
    const clientUserId = clientUsers[0].id;
    
    // 检查是否已是好友
    const { isFriend } = await chatService.checkFriendship(created_by, clientUserId);
    
    if (!isFriend) {
      // 自动建立好友关系
      await supabase
        .from('chat_connections')
        .insert([{
          requester_id: created_by,
          receiver_id: clientUserId,
          status: 'accepted'
        }]);
    }
  },

  // ========== 好友申请管理 ==========
  
  // 发送好友申请
  sendConnectionRequest: async (myId: string, targetId: string) => {
    // 检查是否已存在申请或连接
    const { data: existing } = await supabase
      .from('chat_connections')
      .select('id, status')
      .or(`and(requester_id.eq.${myId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${myId})`);
    
    if (existing && existing.length > 0) {
      return { data: null, error: { message: '已存在好友关系或申请' } };
    }

    const { data, error } = await supabase
      .from('chat_connections')
      .insert([{ requester_id: myId, receiver_id: targetId, status: 'pending' }])
      .select();
    return { data, error };
  },

  // 接受好友申请
  acceptRequest: async (requestId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .update({ status: 'accepted' })
      .eq('id', requestId)
      .select();
    return { data, error };
  },

  // 拒绝好友申请
  rejectRequest: async (requestId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .update({ status: 'rejected' })
      .eq('id', requestId)
      .select();
    return { data, error };
  },

  // 获取我收到的待处理申请
  getPendingRequests: async (myId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .select(`
        *,
        requester:app_users!requester_id(full_name, username, role)
      `)
      .eq('receiver_id', myId)
      .eq('status', 'pending');
    return { data, error };
  },

  // 获取已建立连接的好友列表
  getAcceptedContacts: async (myId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .select(`
        requester_id,
        receiver_id,
        requester:app_users!requester_id(id, full_name, username, role, client_id),
        receiver:app_users!receiver_id(id, full_name, username, role, client_id)
      `)
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'accepted');
    
    if (error) return { error };
    
    const contacts = data.map(conn => 
        conn.requester_id === myId ? conn.receiver : conn.requester
    );
    return { data: contacts };
  },

  // ========== 搜索用户 ==========
  
  // 深度搜索：通过公司名称、纳税号或姓名查找
  searchGlobalEntities: async (queryStr: string) => {
    try {
      // 1. 搜索用户表
      const { data: users, error: userError } = await supabase
        .from('app_users')
        .select('id, full_name, username, role, client_id, department_id')
        .or(`full_name.ilike.%${queryStr}%,username.ilike.%${queryStr}%`);
      
      if (userError) {
        console.error('[chatService] 搜索用户表错误:', userError);
      }
      
      // 2. 搜索客户表
      const { data: clients, error: clientError } = await supabase
        .from('global_clients')
        .select('tax_id, full_name')
        .or(`full_name.ilike.%${queryStr}%,tax_id.ilike.%${queryStr}%`);
      
      if (clientError) {
        console.error('[chatService] 搜索客户表错误:', clientError);
      }
      
      // 3. 合并结果
      const combined = [
          ...(users || []),
          ...(clients || []).map(c => ({
              id: `client_${c.tax_id}`,
              full_name: c.full_name,
              username: c.full_name,
              role: 'client',
              client_id: c.tax_id,
              is_client: true
          }))
      ];
      
      return { data: combined, error: userError || clientError };
    } catch (err) {
      console.error('[chatService] searchGlobalEntities 异常:', err);
      return { data: [], error: err };
    }
  },

  // 获取所有实体（用户 + 客户公司）- 用于管理员查看所有可联系人
  getAllEntities: async () => {
    const [usersResult, clientsResult] = await Promise.all([
      supabase.from('app_users').select('id, full_name, username, role, client_id, department_id').order('full_name', { ascending: true }),
      supabase.from('global_clients').select('tax_id, full_name')
    ]);
    
    const users = usersResult.data || [];
    const clients = (clientsResult.data || []).map(c => ({
      id: `client_${c.tax_id}`,
      full_name: c.full_name,
      username: c.full_name,
      role: 'client',
      client_id: c.tax_id,
      is_client: true
    }));
    
    return { 
      data: [...users, ...clients], 
      error: usersResult.error || clientsResult.error 
    };
  },

  // 获取可以直接聊天的用户列表（内部通信录，按部门分组）
  getInternalContactsGrouped: async (myId: string) => {
    // 获取所有内部员工（role='user'），排除自己，包含部门信息
    const { data, error } = await supabase
      .from('app_users')
      .select(`
        id, full_name, username, role, client_id, department_id,
        departments:department_id (name)
      `)
      .eq('role', 'user')
      .neq('id', myId)
      .order('full_name', { ascending: true });
    
    if (error || !data) return { data: [], error };
    
    // 按部门分组
    const grouped: { [key: string]: any[] } = {};
    
    data.forEach(user => {
      const deptName = (user as any).departments?.name || '未分配部门';
      if (!grouped[deptName]) {
        grouped[deptName] = [];
      }
      grouped[deptName].push(user);
    });
    
    return { data: grouped, error: null };
  },

  // 获取外部联系人（客户 + 合作伙伴）
  getExternalContacts: async (myId: string) => {
    // 1. 获取已有好友关系的客户
    const { data: friends } = await supabase
      .from('chat_connections')
      .select(`
        requester_id,
        receiver_id,
        requester:app_users!requester_id(id, full_name, username, role, client_id),
        receiver:app_users!receiver_id(id, full_name, username, role, client_id)
      `)
      .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
      .eq('status', 'accepted');
    
    const friendIds = new Set<string>();
    friends?.forEach(conn => {
      const otherId = conn.requester_id === myId ? conn.receiver_id : conn.requester_id;
      friendIds.add(otherId);
    });
    
    // 2. 获取所有客户用户
    const { data: clients, error } = await supabase
      .from('app_users')
      .select('id, full_name, username, role, client_id')
      .eq('role', 'client')
      .order('full_name', { ascending: true });
    
    if (error || !clients) return { data: [], error };
    
    // 3. 标记哪些是好友
    const externalContacts = clients.map(client => ({
      ...client,
      is_friend: friendIds.has(client.id)
    }));
    
    return { data: externalContacts, error: null };
  },
  
  // 获取贸易伙伴（根据贸易记录自动建立关系）
  getTradePartners: async (myId: string) => {
    // 获取当前用户的信息
    const { data: me } = await supabase
      .from('app_users')
      .select('id, role, client_id, org_id')
      .eq('id', myId)
      .single();
    
    if (!me) return { data: [], error: null };
    
    let partnerIds = new Set<string>();
    
    if (me.role === 'user') {
      // 内部用户：查找 created_by = myId 的发票，获取对应的客户
      const { data: invoices } = await supabase
        .from('invoices')
        .select('client_tax_id')
        .eq('created_by', myId);
      
      if (invoices) {
        const clientTaxIds = [...new Set(invoices.map(inv => inv.client_tax_id))];
        
        // 查找对应的客户用户
        const { data: clientUsers } = await supabase
          .from('app_users')
          .select('id')
          .eq('role', 'client')
          .in('client_id', clientTaxIds);
        
        if (clientUsers) {
          clientUsers.forEach(u => partnerIds.add(u.id));
        }
      }
    } else if (me.role === 'client') {
      // 客户用户：查找 client_tax_id = my.client_id 的发票，获取对应的创建者
      const { data: invoices } = await supabase
        .from('invoices')
        .select('created_by')
        .eq('client_tax_id', me.client_id);
      
      if (invoices) {
        const userIds = [...new Set(invoices.map(inv => inv.created_by))];
        
        userIds.forEach(id => {
          if (id) partnerIds.add(id);
        });
      }
    }
    
    // 获取伙伴的详细信息
    if (partnerIds.size === 0) return { data: [], error: null };
    
    const { data: partners, error } = await supabase
      .from('app_users')
      .select('id, full_name, username, role, client_id')
      .in('id', Array.from(partnerIds))
      .order('full_name', { ascending: true });
    
    return { data: partners || [], error };
  },
  
  // 获取特定贸易记录相关的讨论
  getTradeMessages: async (tradeId: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        *,
        sender:app_users!sender_id(full_name)
      `)
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });
    return { data, error };
  },

  // 获取与特定用户的聊天记录（兼容旧代码）
  getMessagesWithUserLegacy: async (myId: string, otherId: string) => {
    return chatService.getMessagesWithUser(myId, otherId);
  },

  // 获取所有可联系的人员列表（兼容旧代码）
  getAllUsers: async () => {
    return chatService.getAllEntities();
  },

  // 获取同部门员工列表
  getDepartmentMembers: async (departmentId: string, excludeUserId: string) => {
    if (!departmentId) return { data: [] };
    const { data, error } = await supabase
      .from('app_users')
      .select('id, full_name, username, role, client_id, department_id')
      .eq('department_id', departmentId)
      .neq('id', excludeUserId)
      .order('full_name', { ascending: true });
    return { data, error };
  },

  // 自动建立连接 (业务驱动)
  ensureConnection: async (myId: string, otherId: string) => {
    if (!myId || !otherId || myId === otherId) return;
    
    // 检查是否已存在
    const { data: existing } = await supabase
      .from('chat_connections')
      .select('id')
      .or(`and(requester_id.eq.${myId},receiver_id.eq.${otherId}),and(requester_id.eq.${otherId},receiver_id.eq.${myId})`);
    
    if (existing && existing.length > 0) return;
    
    // 不存在则自动建立已通过的连接
    await supabase
      .from('chat_connections')
      .insert([{ requester_id: myId, receiver_id: otherId, status: 'accepted' }]);
  },
};
