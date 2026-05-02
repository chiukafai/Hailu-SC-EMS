import { useState, useCallback } from 'react';
import { supabase } from '../api/supabase';

export interface InvoiceFilters {
  product_info: string;
  org_name: string;
  client_name: string;
  trade_location: string;
  invoice_status: string;
  transaction_status: string;
  trade_date_start: string;
  trade_date_end: string;
  department_id: string;
}

export interface InvoiceStats {
  totalRevenue: number;
  invoicedRevenue: number;
  pendingCount: number;
}

interface UseInvoicesOptions {
  permissionLevel?: string;
  currentUser?: any;
}

export function useInvoices({ permissionLevel = 'edit', currentUser }: UseInvoicesOptions) {
  const [records, setRecords]         = useState<any[]>([]);
  const [orgs, setOrgs]               = useState<any[]>([]);
  const [clients, setClients]         = useState<any[]>([]);
  const [allDepartments, setDepts]    = useState<any[]>([]);
  const [tradeLinks, setTradeLinks]   = useState<Record<string, number>>({});
  const [totalCount, setTotalCount]   = useState(0);
  const [stats, setStats]             = useState<InvoiceStats>({ totalRevenue: 0, invoicedRevenue: 0, pendingCount: 0 });
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);

  const fetchData = useCallback(async (
    page: number,
    filters: InvoiceFilters,
    pageSize: number,
  ) => {
    setLoading(true);

    // Resolve client name → tax_ids
    let matchedClientTaxIds: string[] | null = null;
    if (filters.client_name) {
      const { data: mc } = await supabase
        .from('global_clients')
        .select('tax_id')
        .ilike('full_name', `%${filters.client_name}%`);
      matchedClientTaxIds = mc?.map(c => c.tax_id) || [];
      if (matchedClientTaxIds.length === 0) {
        setRecords([]); setTotalCount(0);
        setStats({ totalRevenue: 0, invoicedRevenue: 0, pendingCount: 0 });
        setLoading(false);
        return;
      }
    }

    // Build query
    let query = supabase
      .from('invoices')
      .select('*, organizations!invoices_org_id_fkey(name)', { count: 'exact' });

    if (permissionLevel === 'head' || permissionLevel === 'edit') {
      if (currentUser?.department_id) {
        query = query.or(`department_id.eq.${currentUser.department_id},invoice_handler_dept_id.eq.${currentUser.department_id},cashier_handler_dept_id.eq.${currentUser.department_id}`);
      } else if (currentUser?.id) {
        query = query.eq('created_by', currentUser.id);
      }
    }

    if (filters.product_info)        query = query.ilike('product_info', `%${filters.product_info}%`);
    if (filters.org_name)            query = query.ilike('organizations.name', `%${filters.org_name}%`);
    if (matchedClientTaxIds)         query = query.in('client_tax_id', matchedClientTaxIds);
    if (filters.trade_location)      query = query.ilike('trade_location', `%${filters.trade_location}%`);
    if (filters.invoice_status)      query = query.eq('invoice_status', filters.invoice_status);
    if (filters.transaction_status)  query = query.eq('transaction_status', filters.transaction_status);
    if (filters.trade_date_start)    query = query.gte('trade_date', filters.trade_date_start);
    if (filters.trade_date_end)      query = query.lte('trade_date', filters.trade_date_end);
    if (filters.department_id)       query = query.eq('department_id', filters.department_id);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('trade_date', { ascending: false });

    const { data: r, count, error } = await query;

    if (error) {
      setFetchError(`获取数据失败: ${error.message}${error.hint ? ' (' + error.hint + ')' : ''}`);
      setRecords([]);
    } else {
      setFetchError(null);
      setRecords(r || []);
      setTotalCount(count || 0);
    }

    // Side data
    const [{ data: o }, { data: c }, { data: d }] = await Promise.all([
      supabase.from('organizations').select('*'),
      supabase.from('global_clients').select('*'),
      supabase.from('departments').select('id, name'),
    ]);
    if (o) setOrgs(o);
    if (c) setClients(c);
    if (d) setDepts(d);

    // Aggregated stats via RPC (with fallback)
    try {
      const { data: rpcStats, error: rpcError } = await supabase.rpc('get_invoice_stats', {
        p_dept_id: (permissionLevel === 'head' || permissionLevel === 'edit') ? (currentUser?.department_id || null) : null,
        p_user_id: (permissionLevel === 'head' || permissionLevel === 'edit') && !currentUser?.department_id ? (currentUser?.id || null) : null,
        p_product: filters.product_info || null,
        p_org_name: filters.org_name || null,
        p_client_tax_ids: matchedClientTaxIds,
        p_location: filters.trade_location || null,
        p_invoice_status: filters.invoice_status || null,
        p_transaction_status: filters.transaction_status || null,
        p_start_date: filters.trade_date_start || null,
        p_end_date: filters.trade_date_end || null,
      });
      if (rpcError) throw rpcError;
      if (rpcStats?.length > 0) {
        setStats({
          totalRevenue:    rpcStats[0].total_revenue || 0,
          invoicedRevenue: rpcStats[0].invoiced_revenue || 0,
          pendingCount:    rpcStats[0].pending_count || 0,
        });
      }
    } catch {
      if (r) {
        setStats({
          totalRevenue:    r.reduce((s: number, i: any) => s + Number(i.amount), 0),
          invoicedRevenue: r.filter((i: any) => i.invoice_status === 'invoiced').reduce((s: number, i: any) => s + Number(i.amount), 0),
          pendingCount:    r.filter((i: any) => i.invoice_status === 'pending' || i.transaction_status === 'pending').length,
        });
      }
    }

    // Trade links
    if (r && r.length > 0) {
      const ids = r.map((i: any) => i.id);
      const { data: lt } = await supabase
        .from('tax_invoice_trade_links')
        .select('trade_id, allocated_amount')
        .in('trade_id', ids);
      const totals: Record<string, number> = {};
      lt?.forEach((l: any) => { totals[l.trade_id] = (totals[l.trade_id] || 0) + Number(l.allocated_amount); });
      setTradeLinks(totals);
    }

    setLoading(false);
  }, [permissionLevel, currentUser]);

  return { records, orgs, clients, allDepartments, tradeLinks, totalCount, stats, fetchError, loading, fetchData };
}
