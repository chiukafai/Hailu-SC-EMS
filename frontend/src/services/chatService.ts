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

export const chatService = {
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
        sender:app_users!sender_id(full_name)
      `)
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`)
      .order('created_at', { ascending: true });
    return { data, error };
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

  // 获取最近联系人列表
  getRecentContacts: async (myId: string) => {
    // 这是一个稍微复杂的查询，获取与我交流过的所有人
    const { data, error } = await supabase
      .from('chat_messages')
      .select('sender_id, receiver_id')
      .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`);
    
    if (error) return { error };

    const contactIds = new Set<string>();
    data.forEach(m => {
      if (m.sender_id !== myId) contactIds.add(m.sender_id);
      if (m.receiver_id && m.receiver_id !== myId) contactIds.add(m.receiver_id);
    });

    const { data: users, error: userError } = await supabase
      .from('app_users')
      .select('id, full_name, role, client_id')
      .in('id', Array.from(contactIds));

    return { data: users, error: userError };
  },

  // 获取与我相关的所有消息 (管理员可看全部)
  getAllMessages: async (myId: string, role: string) => {
    let query = supabase
      .from('chat_messages')
      .select(`
        *,
        sender:app_users!sender_id(full_name)
      `);

    if (role !== 'admin') {
      query = query.or(`sender_id.eq.${myId},receiver_id.eq.${myId}`);
    }
    
    const { data, error } = await query.order('created_at', { ascending: true });
    return { data, error };
  },

  // 获取所有可联系的人员列表
  getAllUsers: async () => {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, full_name, username, role, client_id')
      .order('full_name', { ascending: true });
    return { data, error };
  },

  // 发送好友/业务协同申请
  sendConnectionRequest: async (myId: string, targetId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .insert([{ requester_id: myId, receiver_id: targetId, status: 'pending' }]);
    return { data, error };
  },

  // 获取我收到的申请
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

  // 接受申请
  acceptRequest: async (requestId: string) => {
    const { data, error } = await supabase
      .from('chat_connections')
      .update({ status: 'accepted' })
      .eq('id', requestId);
    return { data, error };
  },

  // 获取已建立连接的联系人
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

  // 深度搜索：通过公司名称、纳税号或姓名查找
  searchGlobalEntities: async (queryStr: string) => {
    // 1. 搜索客户表 (获取纳税号)
    const { data: clients } = await supabase
      .from('global_clients')
      .select('tax_id, full_name')
      .or(`full_name.ilike.%${queryStr}%,tax_id.eq.${queryStr}`);
    
    // 2. 搜索内部组织表 (获取组织ID)
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')
      .ilike('name', `%${queryStr}%`);

    const clientTaxIds = clients?.map(c => c.tax_id) || [];
    const orgIds = orgs?.map(o => o.id) || [];

    // 3. 构建用户表查询
    // 匹配：姓名、用户名、所属客户ID、或管理员手动填写的备注
    let userQuery = supabase
      .from('app_users')
      .select('id, full_name, username, role, client_id');
    
    const filters = [`full_name.ilike.%${queryStr}%`, `username.ilike.%${queryStr}%` ];
    
    if (clientTaxIds.length > 0) {
        // 格式化为: client_id.in.("ID1","ID2")
        filters.push(`client_id.in.("${clientTaxIds.join('","')}")`);
    }

    const { data: users, error } = await userQuery.or(filters.join(','));
    return { data: users, error };
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
  }
};
