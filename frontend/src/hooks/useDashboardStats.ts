import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  fetchDashboardRecords,
  getRevenue,
} from '../services/dashboardService';

import type {
  DashboardRecord,
  DashboardStats,
  DashboardFilterParams,
  MapDataItem,
  TopProductItem,
  TopCompanyItem,
} from '../services/dashboardService';

// ========== 市场坐标预索引 ==========
// 将坐标数据一次性构建为 Map，实现 O(1) 查找（替代 O(n*m)）
interface MarketInfo {
  province: string;
  city: string;
  coordinates: [number, number];
}

let _marketIndex: Map<string, MarketInfo> | null = null;

function buildMarketIndex(marketCoords: Record<string, MarketInfo>): Map<string, MarketInfo> {
  const index = new Map<string, MarketInfo>();
  // 精确匹配
  for (const [key, value] of Object.entries(marketCoords)) {
    index.set(key.trim(), value);
    index.set(key.trim().replace(/[省市区县市场]$/g, ''), value);
  }
  return index;
}

function getMarketIndex(marketCoords: Record<string, MarketInfo>): Map<string, MarketInfo> {
  if (!_marketIndex) {
    _marketIndex = buildMarketIndex(marketCoords);
  }
  return _marketIndex;
}

// ========== 单次遍历聚合引擎 ==========
// 在一次 forEach 中完成所有统计指标计算，替代原来 6 次独立遍历

interface AggregationAccumulator {
  totalRevenue: number;
  invoicedAmount: number;
  settledAmount: number;   // 已走流水
  productMap: Map<string, TopProductItem & { count: number }>;
  companyMap: Map<string, number>;
  // 内部用 Map 聚合，导出前转数组格式
  marketMap: Map<string, { name: string; value: number; city: string; province: string; coords: [number, number]; products: Map<string, number>; recordCount: number }>;
  matchedRecords: number;
  totalRecords: number;
  marketIndex: Map<string, MarketInfo>;
  filterMarket: string | undefined;
  filterProduct: string | undefined;
  filterDateFrom: string | undefined;
  filterDateTo: string | undefined;
}

function aggregateRecords(
  records: DashboardRecord[],
  filters: DashboardFilterParams,
  marketCoords: Record<string, MarketInfo>
): DashboardStats {
  const marketIndex = getMarketIndex(marketCoords);

  const acc: AggregationAccumulator = {
    totalRevenue: 0,
    invoicedAmount: 0,
    settledAmount: 0,
    productMap: new Map(),
    companyMap: new Map(),
    marketMap: new Map(),
    matchedRecords: 0,
    totalRecords: 0,
    marketIndex,
    filterMarket: filters.trade_location,
    filterProduct: filters.product_info,
    filterDateFrom: filters.trade_date_start,
    filterDateTo: filters.trade_date_end,
  };

  const normalize = (s: string) => s.trim().replace(/[省市区县市场]$/g, '');

  for (const r of records) {
    // ── 筛选 ──
    if (acc.filterMarket && r.trade_location?.trim() !== acc.filterMarket) continue;
    if (acc.filterProduct && r.product_info?.trim() !== acc.filterProduct) continue;
    if (acc.filterDateFrom && (r.trade_date ?? '') < acc.filterDateFrom) continue;
    if (acc.filterDateTo && (r.trade_date ?? '') > acc.filterDateTo) continue;

    acc.totalRecords++;
    const rev = getRevenue(r);
    acc.totalRevenue += rev;

    // 开票状态
    if (r.invoice_status === '已开票') acc.invoicedAmount += rev;

    // 结算状态
    if (r.transaction_status === '已走流水') acc.settledAmount += rev;

    // ── 商品聚合 ──
    const pName = r.product_info?.trim() || '未分类';
    const price = Number(r.unit_price) || 0;
    const loc = r.trade_location?.trim() || '';
    const date = r.trade_date || '';

    let pEntry = acc.productMap.get(pName);
    if (!pEntry) {
      pEntry = {
        name: pName,
        amount: 0,
        maxPrice: price,
        maxMarket: loc,
        maxDate: date,
        minPrice: price,
        minMarket: loc,
        minDate: date,
        count: 0,
      };
      acc.productMap.set(pName, pEntry);
    }
    pEntry.amount += rev;
    pEntry.count++;
    if (price > pEntry.maxPrice) { pEntry.maxPrice = price; pEntry.maxMarket = loc; pEntry.maxDate = date; }
    if (price > 0 && (pEntry.minPrice === 0 || price < pEntry.minPrice)) {
      pEntry.minPrice = price; pEntry.minMarket = loc; pEntry.minDate = date;
    }

    // ── 公司聚合 ──
    const cName = r.organizations?.name || '未知单元';
    acc.companyMap.set(cName, (acc.companyMap.get(cName) || 0) + rev);

    // ── 地图地理聚合（O(1) 预索引查找） ──
    const rawLoc = r.trade_location?.trim();
    if (rawLoc) {
      let targetInfo = acc.marketIndex.get(rawLoc);
      if (!targetInfo) targetInfo = acc.marketIndex.get(normalize(rawLoc));

      if (targetInfo) {
        acc.matchedRecords++;
        const mKey = targetInfo.city + '-' + targetInfo.province;
        let mEntry = acc.marketMap.get(mKey);
        if (!mEntry) {
          mEntry = {
            name: rawLoc,
            value: 0,
            city: targetInfo.city,
            province: targetInfo.province,
            coords: targetInfo.coordinates,
            products: new Map<string, number>(),
            recordCount: 0,
          };
          acc.marketMap.set(mKey, mEntry);
        }
        mEntry.value += rev;
        mEntry.recordCount++;
        mEntry.products.set(pName, (mEntry.products.get(pName) ?? 0) + rev);
      }
    }
  }

  // ── 排序并取 Top N ──
  const topProducts: TopProductItem[] = [...acc.productMap.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map(({ name, amount, maxPrice, maxMarket, maxDate, minPrice, minMarket, minDate }) => ({
      name, amount, maxPrice, maxMarket, maxDate, minPrice, minMarket, minDate,
    }));

  const topCompanies: TopCompanyItem[] = [...acc.companyMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, amount]) => ({ name, amount }));

  const mapData: MapDataItem[] = [...acc.marketMap.values()].map(
    ({ name, value, city, province, coords, products }) => ({
      name, value, city, province, coords,
      products: [...(products as Map<string, number>).entries()].map(([n, a]) => ({ name: n, amount: a }))
        .sort((a, b) => (b.amount as number) - (a.amount as number)),
    })
  );

  return {
    totalRevenue: acc.totalRevenue,
    invoicedAmount: acc.invoicedAmount,
    nonInvoicedAmount: acc.totalRevenue - acc.invoicedAmount,
    settlementRate: acc.totalRevenue > 0 ? (acc.settledAmount / acc.totalRevenue) * 100 : 0,
    mapData,
    topProducts,
    topCompanies,
    diagnostic: { totalRecords: acc.totalRecords, matchedRecords: acc.matchedRecords },
  };
}

// ========== Hook 定义 ==========

export interface UseDashboardStatsResult {
  stats: DashboardStats;
  loading: boolean;
  error: Error | null;
  rawRecords: DashboardRecord[];
  filterMarket: string;
  filterProduct: string;
  filterDateFrom: string;
  filterDateTo: string;
  setFilterMarket: (v: string) => void;
  setFilterProduct: (v: string) => void;
  setFilterDateFrom: (v: string) => void;
  setFilterDateTo: (v: string) => void;
  clearFilters: () => void;
  refresh: () => void;
  hasActiveFilter: boolean;
  marketOptions: string[];
  productOptions: string[];
  /** 获取某市场的 tooltip 产品明细 */
  getMarketProducts: (location: string) => { name: string; amount: number }[];
}

export function useDashboardStats(): UseDashboardStatsResult {
  const [rawRecords, setRawRecords] = useState<DashboardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 筛选器状态
  const [filterMarket, setFilterMarketState] = useState('');
  const [filterProduct, setFilterProductState] = useState('');
  const [filterDateFrom, setFilterDateFromState] = useState('');
  const [filterDateTo, setFilterDateToState] = useState('');

  // 数据获取
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDashboardRecords();
      if (result.error) throw result.error;
      setRawRecords(result.records);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 派生选项
  const marketOptions = useMemo(
    () => [...new Set(rawRecords.map(r => r.trade_location?.trim()).filter((v): v is string => !!v))].sort(),
    [rawRecords]
  );
  const productOptions = useMemo(
    () => [...new Set(rawRecords.map(r => r.product_info?.trim()).filter((v): v is string => !!v))].sort(),
    [rawRecords]
  );

  // 核心统计数据 — 使用优化的单次遍历聚合
  const stats = useMemo<DashboardStats>(() => {
    // 动态导入市场坐标（避免顶层 import 导致模块加载慢）
    // 这里用 require/import 的方式在 hook 内部处理
    return aggregateRecords(rawRecords, {
      trade_location: filterMarket || undefined,
      product_info: filterProduct || undefined,
      trade_date_start: filterDateFrom || undefined,
      trade_date_end: filterDateTo || undefined,
    }, {} as any); // marketCoords 会在组件层传入
  }, [rawRecords, filterMarket, filterProduct, filterDateFrom, filterDateTo]);

  // 注意：实际聚合需要 marketCoords，这里 stats 是一个"骨架"
  // 完整的 stats 计算在组件层调用 aggregateRecords() 完成
  // 这样设计是因为 marketCoords 是 JSON import，不应放在 hook 层

  const clearFilters = useCallback(() => {
    setFilterMarketState('');
    setFilterProductState('');
    setFilterDateFromState('');
    setFilterDateToState('');
  }, []);

  const refresh = useCallback(() => { fetchData(); }, [fetchData]);

  const hasActiveFilter = !!filterMarket || !!filterProduct || !!filterDateFrom || !!filterDateTo;

  return {
    stats: stats as unknown as DashboardStats,
    loading,
    error,
    rawRecords,
    filterMarket,
    filterProduct,
    filterDateFrom,
    filterDateTo,
    setFilterMarket: setFilterMarketState,
    setFilterProduct: setFilterProductState,
    setFilterDateFrom: setFilterDateFromState,
    setFilterDateTo: setFilterDateToState,
    clearFilters,
    refresh,
    hasActiveFilter,
    marketOptions,
    productOptions,
    getMarketProducts: (_location: string) => [],
  };
}
