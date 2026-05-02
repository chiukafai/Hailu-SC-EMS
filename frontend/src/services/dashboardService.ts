import { supabase } from './supabaseClient';

// ========== Dashboard 统计类型 ==========
export interface DashboardRecord {
  id: string;
  trade_date: string;
  product_info: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  invoice_status: string | null;
  transaction_status: string | null;
  trade_location: string | null;
  org_id?: string | null;
  organizations?: { name: string } | null;
}

export interface DashboardStats {
  totalRevenue: number;
  invoicedAmount: number;
  nonInvoicedAmount: number;
  settlementRate: number;
  mapData: MapDataItem[];
  topProducts: TopProductItem[];
  topCompanies: TopCompanyItem[];
  diagnostic: { totalRecords: number; matchedRecords: number };
}

export interface MapDataItem {
  name: string;
  value: number;
  city: string;
  province: string;
  coords: [number, number];
  products?: { name: string; amount: number }[];
}

export interface TopProductItem {
  name: string;
  amount: number;
  maxPrice: number;
  maxMarket: string;
  maxDate: string;
  minPrice: number;
  minMarket: string;
  minDate: string;
}

export interface TopCompanyItem {
  name: string;
  amount: number;
}

export interface DashboardFilterParams {
  trade_location?: string;
  product_info?: string;
  trade_date_start?: string;
  trade_date_end?: string;
}

// ========== 营收计算 ==========
export function getRevenue(r: DashboardRecord): number {
  return (Number(r.quantity) * Number(r.unit_price)) || Number(r.amount) || 0;
}

// ========== 核心查询 ==========

/**
 * 获取仪表盘数据（带日期范围限制，防止全表拉取）
 *
 * @param dateFrom 最早交易日期（YYYY-MM-DD），不传则取最近 3 年
 * @param dateTo 最晚交易日期（YYYY-MM-DD）
 */
export async function fetchDashboardRecords(
  dateFrom?: string,
  dateTo?: string
): Promise<{ records: DashboardRecord[]; error: Error | null }> {
  let query = supabase
    .from('invoices')
    .select('*, organizations!invoices_org_id_fkey(name)')
    .order('trade_date', { ascending: false });

  // 默认限制：只查最近 3 年的数据（防止全表扫描）
  if (!dateFrom) {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    dateFrom = threeYearsAgo.toISOString().split('T')[0];
  }

  if (dateFrom) {
    query = query.gte('trade_date', dateFrom);
  }
  if (dateTo) {
    query = query.lte('trade_date', dateTo);
  }

  const { data, error } = await query;

  return {
    records: (data ?? []) as DashboardRecord[],
    error: error ? new Error(error.message) : null,
  };
}

/**
 * 使用已有的 get_invoice_stats RPC 做服务端聚合（如果可用）
 * RPC 返回预聚合的统计数据，大幅减少前端计算量
 */
export async function fetchAggregatedStats(
  dateFrom?: string,
  dateTo?: string
): Promise<{ stats: Record<string, unknown> | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('get_invoice_stats', {
      p_date_from: dateFrom || '',
      p_date_to: dateTo || '',
    });

    if (error) {
      // RPC 不存在或出错时返回 null，调用方降级到前端聚合
      return { stats: null, error: new Error(error.message) };
    }

    return { stats: data as Record<string, unknown>, error: null };
  } catch (e) {
    return { stats: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
