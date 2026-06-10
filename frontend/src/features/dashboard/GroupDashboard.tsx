import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import chinaGeoJson from '../../data/china.json';
import marketCoordsObj from '../../data/market_coordinates.json';
import marketAbbrObj from '../../data/market_abbreviations.json';

import {
  fetchDashboardRecords,
  getRevenue,
} from '../../services/dashboardService';

import type {
  DashboardRecord,
  DashboardStats,
  MapDataItem,
  TopProductItem,
  TopCompanyItem,
} from '../../services/dashboardService';

// ========== 常量 ==========
const marketCoords = marketCoordsObj as unknown as Record<string, {province: string, city: string, coordinates: [number, number]}>;
const MARKET_ABBR: Record<string, string> = marketAbbrObj as Record<string, string>;
const getAbbr = (market: string) => MARKET_ABBR[market] || market;

const PROVINCE_COLORS: Record<string, string> = {
    "广东": "#3b82f6", "四川": "#ec4899", "海南": "#10b981",
    "安徽": "#f59e0b", "江西": "#8b5cf6", "江苏": "#14b8a6",
    "福建": "#f43f5e", "上海": "#6366f1", "天津": "#06b6d4",
    "湖北": "#eab308", "陕西": "#84cc16", "湖南": "#d946ef",
    "河南": "#0ea5e9", "重庆": "#f97316", "DEFAULT": "#4f46e5"
};

echarts.registerMap('china', chinaGeoJson as any);

// ========== 地理预索引（一次性构建，O(1) 查找） ==========
interface MarketInfo { province: string; city: string; coordinates: [number, number]; }
let _geoIndex: Map<string, MarketInfo> | null = null;
// 保存完整市场名列表，用于 contains 兜底匹配
let _fullMarketKeys: string[] = [];
function getGeoIndex(): Map<string, MarketInfo> {
    if (!_geoIndex) {
        _geoIndex = new Map();
        _fullMarketKeys = Object.keys(marketCoords);
        for (const [key, val] of Object.entries(marketCoords)) {
            const trimmed = key.trim();
            // 1. 完整市场名 → 精确匹配
            _geoIndex.set(trimmed, val);
            // 2. 去掉末尾省市区县市场 → 模糊匹配
            _geoIndex.set(trimmed.replace(/[省市区县市场]$/g, ''), val);
            // 3. 城市名（如 "深圳", "广州"）→ 反向映射到该市场
            //    仅当该城市名尚未被其他市场占用时才写入（避免同城多市场冲突时丢失）
            if (val.city && !_geoIndex.has(val.city)) {
                _geoIndex.set(val.city, val);
            }
        }
    }
    return _geoIndex;
}

/** 兜底：在完整市场名列表中搜索「包含关系」 */
function fallbackGeoMatch(loc: string): MarketInfo | undefined {
    const trimmed = loc.trim();
    // 情况A: trade_location 是市场名的子串 (如 "深圳" 包含在 "深圳海吉星农产品批发市场" 中)
    for (const key of _fullMarketKeys) {
        if (key.includes(trimmed)) {
            return (marketCoords as Record<string, MarketInfo>)[key];
        }
    }
    // 情况B: trade_location 包含市场名 (如 "广州江南市场XXX" 包含 "广州江南")
    for (const key of _fullMarketKeys) {
        if (trimmed.includes(key.substring(0, Math.min(4, key.length)))) {
            return (marketCoords as Record<string, MarketInfo>)[key];
        }
    }
    return undefined;
}

// ========== 短名 → 全称 解析（用于下拉框展示和筛选匹配） ==========
let _nameToFullMap: Map<string, string> | null = null;
function getNameToFullMap(): Map<string, string> {
    if (!_nameToFullMap) {
        _nameToFullMap = new Map();
        for (const [fullName, val] of Object.entries(marketCoords)) {
            const trimmed = fullName.trim();
            // 完整名映射到自身
            _nameToFullMap.set(trimmed, trimmed);
            // 城市名映射到完整市场名（优先第一个匹配）
            if (val.city && !_nameToFullMap.has(val.city)) {
                _nameToFullMap.set(val.city, trimmed);
            }
        }
    }
    return _nameToFullMap;
}

/** 将任意 trade_location（可能是短名如"深圳"）解析为完整市场名 */
function resolveFullMarketName(loc: string): string {
    const trimmed = loc.trim();
    const map = getNameToFullMap();
    // 1. 精确查找（完整名或城市名）
    const direct = map.get(trimmed);
    if (direct) return direct;
    // 2. 子串包含兜底
    for (const key of _fullMarketKeys) {
        if (key.includes(trimmed)) return key;
    }
    // 3. 无法解析，返回原名
    return trimmed;
}

function computeStats(
    records: DashboardRecord[],
    fMarket: string | undefined,
    fProduct: string | undefined,
    fDateFrom: string | undefined,
    fDateTo: string | undefined,
    pClientId?: string
): DashboardStats & {
    marketDetailMap: Map<string, { name: string; value: number; city: string; province: string; coords: [number, number]; products: Map<string, number>; recordCount: number }>;
    myStats: { revenue: number; orderCount: number; productCount: number };
} {
    const geoIdx = getGeoIndex();
    const normalize = (s: string) => s.trim().replace(/[省市区县市场]$/g, '');

    // 所有聚合在一次遍历中完成
    let totalRev = 0, invoicedAmt = 0, settledAmt = 0, matchedCount = 0, totalCnt = 0;
    let myRev = 0, myOrders = 0;
    const myProducts = new Set<string>();
    const productMap = new Map<string, TopProductItem & { count: number }>();
    const companyMap = new Map<string, number>();
    const marketMap = new Map<string, { name: string; value: number; city: string; province: string; coords: [number, number]; products: Map<string, number>; recordCount: number }>();

    for (const r of records) {
        if (fMarket && resolveFullMarketName(r.trade_location?.trim() || '') !== fMarket) continue;
        if (fProduct && r.product_info?.trim() !== fProduct) continue;
        if (fDateFrom && (r.trade_date ?? '') < fDateFrom) continue;
        if (fDateTo && (r.trade_date ?? '') > fDateTo) continue;

        totalCnt++;
        const rev = getRevenue(r);
        totalRev += rev;

        if (r.invoice_status === '已开票') invoicedAmt += rev;
        if (r.transaction_status === '已走流水') settledAmt += rev;

        // 客商自身数据统计
        if (pClientId && (r.client_tax_id === pClientId || r.subject_client_tax_id === pClientId)) {
            myRev += rev;
            myOrders++;
            if (r.product_info) myProducts.add(r.product_info.trim());
        }
        // 商品
        const pName = r.product_info?.trim() || '未分类';
        const price = Number(r.unit_price) || 0;
        const loc = r.trade_location?.trim() || '';
        const date = r.trade_date || '';

        let pEnt = productMap.get(pName);
        if (!pEnt) {
            pEnt = { name: pName, amount: 0, maxPrice: price, maxMarket: loc, maxDate: date,
                      minPrice: price, minMarket: loc, minDate: date, count: 0 };
            productMap.set(pName, pEnt);
        }
        pEnt.amount += rev; pEnt.count++;
        if (price > pEnt.maxPrice) { pEnt.maxPrice = price; pEnt.maxMarket = loc; pEnt.maxDate = date; }
        if (price > 0 && (pEnt.minPrice === 0 || price < pEnt.minPrice)) {
            pEnt.minPrice = price; pEnt.minMarket = loc; pEnt.minDate = date;
        }

        // 公司
        const cName = r.organizations?.name || '未知单元';
        companyMap.set(cName, (companyMap.get(cName) || 0) + rev);

        // 地图（O(1) 索引查找 + 兜底 contains 匹配）
        const rawLoc = r.trade_location?.trim();
        if (rawLoc) {
            let info = geoIdx.get(rawLoc) || geoIdx.get(normalize(rawLoc)) || fallbackGeoMatch(rawLoc);
            if (info) {
                matchedCount++;
                const mKey = info.city + '-' + info.province;
                let mEnt = marketMap.get(mKey);
                if (!mEnt) {
                    mEnt = { name: rawLoc, value: 0, city: info.city, province: info.province,
                             coords: info.coordinates, products: new Map<string, number>(), recordCount: 0 };
                    marketMap.set(mKey, mEnt);
                }
                const entry = mEnt!;
                entry.value += rev; entry.recordCount++;
                entry.products.set(pName, (entry.products.get(pName) || 0) + rev);
            }
        }
    }

    // 排序取 Top
    const topProducts: TopProductItem[] = [...productMap.values()]
        .sort((a, b) => b.amount - a.amount).slice(0, 10)
        .map(({ name, amount, maxPrice, maxMarket, maxDate, minPrice, minMarket, minDate }) =>
             ({ name, amount, maxPrice, maxMarket, maxDate, minPrice, minMarket, minDate }));

    const topCompanies: TopCompanyItem[] = [...companyMap.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([name, amount]) => ({ name, amount }));

    const mapData: MapDataItem[] = [...marketMap].map(([, v]) => ({
        name: v.name, value: v.value, city: v.city, province: v.province, coords: v.coords,
        products: [...v.products.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .slice(0, 5).map(([n, a]) => ({ name: n, amount: a })),
    }));

    return {
        totalRevenue: totalRev,
        invoicedAmount: invoicedAmt,
        nonInvoicedAmount: totalRev - invoicedAmt,
        settlementRate: totalRev > 0 ? (settledAmt / totalRev) * 100 : 0,
        mapData,
        topProducts,
        topCompanies,
        diagnostic: { totalRecords: totalCnt, matchedRecords: matchedCount },
        marketDetailMap: marketMap,
        myStats: { revenue: myRev, orderCount: myOrders, productCount: myProducts.size }
    };
}

// ========== 组件 ==========
export default function GroupDashboard({ currentUser }: { currentUser?: any }) {
    const [rawRecords, setRawRecords] = useState<DashboardRecord[]>([]);
    const [loading, setLoading] = useState(true);

    // ── 筛选器状态 ──
    const [filterMarket, setFilterMarket] = useState('');
    const [filterProduct, setFilterProduct] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');

    // ── 级联筛选：每个下拉选项根据「其他」已激活筛选条件动态过滤 ──
    const filteredForMarketOptions = useMemo(() =>
        rawRecords.filter(r => {
            if (filterProduct && r.product_info?.trim() !== filterProduct) return false;
            if (filterDateFrom && (r.trade_date ?? '') < filterDateFrom) return false;
            if (filterDateTo && (r.trade_date ?? '') > filterDateTo) return false;
            return true;
        }),
        [rawRecords, filterProduct, filterDateFrom, filterDateTo]
    );

    const filteredForProductOptions = useMemo(() =>
        rawRecords.filter(r => {
            if (filterMarket && resolveFullMarketName(r.trade_location?.trim() || '') !== filterMarket) return false;
            if (filterDateFrom && (r.trade_date ?? '') < filterDateFrom) return false;
            if (filterDateTo && (r.trade_date ?? '') > filterDateTo) return false;
            return true;
        }),
        [rawRecords, filterMarket, filterDateFrom, filterDateTo]
    );

    // 市场下拉选项：将短名解析为全称，去重后排序
    const marketOptions = useMemo(() =>
        [...new Set(filteredForMarketOptions.map(r => {
            const loc = r.trade_location?.trim();
            return loc ? resolveFullMarketName(loc) : '';
        }).filter(Boolean))].sort(),
        [filteredForMarketOptions]
    );
    const productOptions = useMemo(() =>
        [...new Set(filteredForProductOptions.map(r => r.product_info?.trim()).filter(Boolean))].sort(),
        [filteredForProductOptions]
    );

    // 当筛选条件变化导致当前选中值不在可用选项中时，自动清除
    useEffect(() => {
        if (filterMarket && marketOptions.length > 0 && !marketOptions.includes(filterMarket)) {
            setFilterMarket('');
        }
    }, [marketOptions, filterMarket]);

    useEffect(() => {
        if (filterProduct && productOptions.length > 0 && !productOptions.includes(filterProduct)) {
            setFilterProduct('');
        }
    }, [productOptions, filterProduct]);

    // ── 核心统计（单次遍历，O(n) 而非原来的 6×O(n)） ──
    const stats = useMemo(() =>
        computeStats(rawRecords,
            filterMarket || undefined,
            filterProduct || undefined,
            filterDateFrom || undefined,
            filterDateTo || undefined,
            currentUser?.client_id),
        [rawRecords, filterMarket, filterProduct, filterDateFrom, filterDateTo, currentUser]
    );

    // 预构建市场产品明细 Map（用于 tooltip 快速查找）
    const marketProductMap = useMemo(() => stats.marketDetailMap, [stats.marketDetailMap]);

    const fetchGlobalStats = useCallback(async () => {
        setLoading(true);
        try {
            // 【核心优化】根据角色权限自动切换数据抓取范围
            const result = await fetchDashboardRecords(
                undefined, 
                undefined, 
                currentUser?.role !== 'admin' ? currentUser?.department_id : undefined,
                currentUser?.client_id,
                currentUser?.role !== 'admin' ? currentUser?.org_id : undefined
            );

            if (result.error) {
                console.error("Dashboard Fetch Error:", result.error.message);
                // fallback：尝试最基本的查询
                const fb = await fetchDashboardRecords(undefined, undefined, currentUser?.department_id, currentUser?.client_id);
                if (fb.error) console.error("Fallback also failed:", fb.error.message);
                else setRawRecords(fb.records);
            } else {
                setRawRecords(result.records);
            }
        } catch (err) {
            console.error("Dashboard Fetch Exception:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchGlobalStats(); }, [fetchGlobalStats]);

    const clearFilters = () => {
        setFilterMarket(''); setFilterProduct(''); setFilterDateFrom(''); setFilterDateTo('');
    };

    const hasActiveFilter = !!filterMarket || !!filterProduct || !!filterDateFrom || !!filterDateTo;

    // ── ECharts 配置（保持原有 UI 不变） ──
    const mapOption = useMemo(() => ({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255, 255, 255, 0.97)',
            borderColor: '#e2e8f0', borderWidth: 1,
            textStyle: { color: '#0f172a' },
            formatter: (params: any) => {
                if (params.seriesName === '核心市场')
                    return `<div class="p-2 font-bold text-slate-700">${params.name}<br/><span class="text-xs font-normal text-slate-400">${params.data.city} · ${params.data.province}</span></div>`;

                const loc = params.name;
                // 【性能优化】用预索引的 Map 替代 O(n) filter
                const mEntry = marketProductMap.get(loc);
                const total = params.value[2] || 0;
                const recCount = mEntry?.recordCount || 0;
                const prods = [...(mEntry?.products || new Map<string, number>()).entries()] as [string, number][];

                let productHtml = '';
                if (prods.length > 1) {
                    productHtml = '<div class="mt-2 pt-2 border-t border-slate-100">' +
                        prods.map(([p, v]) =>
                            `<div class="flex justify-between text-xs gap-4 py-0.5"><span class="text-slate-500 truncate max-w-[120px]">${p}</span><span class="font-mono font-bold text-slate-700">¥${v.toLocaleString()}</span></div>`
                        ).join('') +
                        (prods.length > 5 ? `<div class="text-xs text-slate-400 mt-1">+${prods.length - 5} 个商品</div>` : '') +
                        '</div>';
                } else if (prods.length === 1) {
                    productHtml = `<div class="text-xs text-slate-400 mt-1">${prods[0][0]}</div>`;
                }

                return `<div class="p-2 min-w-[180px]">
                    <div class="font-bold text-slate-700 text-sm">${loc}</div>
                    <div class="text-xs text-slate-400 mb-1">${params.data.city} · ${params.data.province}</div>
                    <div class="text-xl font-extrabold font-mono mt-1" style="color:${params.color}">¥${total.toLocaleString()}</div>
                    <div class="text-xs text-slate-400">${recCount} 条记录</div>
                    ${productHtml}
                </div>`;
            }
        },
        geo: {
            map: 'china', roam: true, zoom: 1.2,
            backgroundColor: '#e8eef5',
            itemStyle: { areaColor: '#ffffff', borderColor: '#cbd5e1' },
            emphasis: { itemStyle: { areaColor: '#f1f5f9' } },
            regions: Object.entries(PROVINCE_COLORS).map(([name, color]) => ({
                name, itemStyle: { areaColor: name === 'DEFAULT' ? '#f8fafc' : `${color}15` }
            }))
        },
        series: [
            {
                name: '核心市场', type: 'scatter', coordinateSystem: 'geo', zlevel: 1,
                data: Object.entries(marketCoords).map(([name, info]) => ({
                    name, value: info.coordinates, city: info.city, province: info.province
                })),
                symbolSize: 8,
                itemStyle: {
                    color: (p: any) => PROVINCE_COLORS[p.data.province] || PROVINCE_COLORS.DEFAULT,
                    opacity: 0.6, borderColor: '#fff', borderWidth: 1
                }, label: { show: false },
                tooltip: { show: true, formatter: (p: any) =>
                    `<div class="p-2 font-bold text-slate-700">${p.data.name}<br/><span class="text-xs font-normal text-slate-400">${p.data.city} · ${p.data.province}</span></div>`
                }, silent: false
            },
            {
                name: '营收气泡', type: 'scatter', coordinateSystem: 'geo', zlevel: 5,
                data: stats.mapData.map(item => ({
                    name: item.name, province: item.province,
                    value: [item.coords[0], item.coords[1], item.value],
                    itemStyle: {
                        color: (() => {
                            const baseColor = PROVINCE_COLORS[item.province] || PROVINCE_COLORS.DEFAULT;
                            if (!stats.totalRevenue || !item.value) return baseColor;
                            const avgRevenue = stats.totalRevenue / Math.max(1, stats.mapData.length);
                            const raw = item.value / avgRevenue;
                            const ratio = Math.max(0, Math.min(1, (raw - 0.1) / 3));  // 0.1x~3x营收区间映射到0~1
                            try {
                                const c = echarts.color.parse(baseColor);
                                const r = Math.round(c[0] + (255 - c[0]) * (1 - ratio) * 0.7);
                                const g = Math.round(c[1] + (255 - c[1]) * (1 - ratio) * 0.7);
                                const b = Math.round(c[2] + (255 - c[2]) * (1 - ratio) * 0.7);
                                return `rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`;
                            } catch { return baseColor; }
                        })(),
                        shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)'
                    }
                })),
                symbolSize: (val: any) => {
                    if (!stats.totalRevenue) return 10;
                    const ratio = val[2] / stats.totalRevenue;
                    return Math.max(10, Math.min(35, ratio * 150));
                },
                itemStyle: { opacity: 0.85 }
            }
        ]
    }), [stats, marketProductMap]);

    return (
        <div className="p-8 max-w-7xl mx-auto animate-in fade-in duration-1000">
            {/* 标题栏 */}
            <div className="flex justify-between items-end mb-8 relative">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">集团财务概览</h2>
                    <p className="text-slate-500 mt-1 text-sm">实时汇总全集团 100+ 经营单元贸易数据</p>
                </div>


            </div>

            {/* 筛选工具栏 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mb-6">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">市场</label>
                        <select value={filterMarket}
                            onChange={e => setFilterMarket(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[140px]">
                            <option value="">全部市场</option>
                            {marketOptions.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">商品</label>
                        <select value={filterProduct}
                            onChange={e => setFilterProduct(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[140px]">
                            <option value="">全部商品</option>
                            {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">日期</label>
                        <input type="date" value={filterDateFrom}
                            onChange={e => setFilterDateFrom(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        <span className="text-slate-400 text-sm">~</span>
                        <input type="date" value={filterDateTo}
                            onChange={e => setFilterDateTo(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    </div>

                    <button onClick={clearFilters}
                        className={`ml-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${hasActiveFilter ? 'border-rose-200 text-rose-500 hover:bg-rose-50' : 'border-slate-200 text-slate-300 cursor-not-allowed'}`}
                        disabled={!hasActiveFilter}>
                        清除筛选
                    </button>

                    <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                        <span className="font-mono">{stats.diagnostic.totalRecords} 条记录</span>
                        {loading && <span className="text-blue-500 animate-pulse">加载中…</span>}
                    </div>
                </div>
            </div>

            {/* 客商专属突出展示 */}
            {currentUser?.role === 'client' && (
                <div className="mb-10 bg-gradient-to-r from-slate-900 to-indigo-950 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2"></div>
                    
                    <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
                        <div className="lg:col-span-1">
                            <h3 className="text-indigo-400 text-xs font-black uppercase tracking-[0.2em] mb-2">My Business Dashboard</h3>
                            <h4 className="text-3xl font-black text-white leading-tight">我方交易中心<br/><span className="text-slate-400 text-lg font-bold">与海露控股的协同概览</span></h4>
                            <div className="mt-6 flex gap-4">
                                <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5">
                                    <span className="block text-[10px] text-slate-400 font-bold uppercase">交易单数</span>
                                    <span className="text-xl font-black text-white">{stats.myStats.orderCount} <small className="text-xs text-slate-500">笔</small></span>
                                </div>
                                <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5">
                                    <span className="block text-[10px] text-slate-400 font-bold uppercase">合作品类</span>
                                    <span className="text-xl font-black text-white">{stats.myStats.productCount} <small className="text-xs text-slate-500">种</small></span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-white/[0.03] hover:bg-white/[0.07] transition-colors p-6 rounded-3xl border border-white/10 flex flex-col justify-between h-40">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">我方累计交易总额</span>
                                <div>
                                    <span className="text-4xl font-black text-indigo-400 font-mono">¥ {stats.myStats.revenue.toLocaleString()}</span>
                                    <p className="text-[10px] text-slate-500 mt-2">※ 实时汇总当前所有订单数据</p>
                                </div>
                            </div>
                            <div className="bg-white/[0.03] hover:bg-white/[0.07] transition-colors p-6 rounded-3xl border border-white/10 flex flex-col justify-between h-40">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">营收占比 / 贡献度</span>
                                <div>
                                    <span className="text-4xl font-black text-emerald-400 font-mono">
                                        {stats.totalRevenue > 0 ? ((stats.myStats.revenue / stats.totalRevenue) * 100).toFixed(2) : 0}%
                                    </span>
                                    <div className="w-full h-1 bg-white/10 rounded-full mt-3 overflow-hidden">
                                        <div className="h-full bg-emerald-500" style={{ width: `${stats.totalRevenue > 0 ? (stats.myStats.revenue / stats.totalRevenue) * 100 : 0}%` }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 核心指标卡片 */}
            <div className={`grid grid-cols-1 ${currentUser?.role === 'client' ? 'md:grid-cols-4' : 'md:grid-cols-4'} gap-6 mb-10`}>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{currentUser?.role === 'client' ? '全集团累计营收 (市场大盘)' : '累计营业收入'}</p>
                    <p className="text-2xl font-black text-slate-900 mt-2">¥{stats.totalRevenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{currentUser?.role === 'client' ? '我方已确权金额' : '已确认开票'}</p>
                    <p className="text-2xl font-black text-blue-600 mt-2">¥{(currentUser?.role === 'client' ? stats.myStats.revenue : stats.invoicedAmount).toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">资金结清占比</p>
                    <div className="flex items-center gap-3 mt-2">
                        <p className="text-2xl font-black text-green-600">{stats.settlementRate.toFixed(1)}%</p>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500" style={{ width: `${stats.settlementRate}%` }}></div>
                        </div>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">风险待收金额</p>
                    <p className="text-2xl font-black text-rose-500 mt-2">
                        ¥{(stats.totalRevenue - (stats.totalRevenue * (stats.settlementRate/100))).toLocaleString()}
                    </p>
                </div>
            </div>

            {/* 全国营收热力透视 */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden mb-10">
                <div className="p-6 border-b border-slate-50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <h3 className="font-bold text-slate-800">全国营收热力透视</h3>
                        {hasActiveFilter && (
                            <span className="bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">已筛选</span>
                        )}
                    </div>
                    <div className="flex gap-2 text-[10px] font-bold">
                        <span className="flex items-center gap-1 text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-200"></span> 核心点位</span>
                        <span className="flex items-center gap-1 text-blue-500"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> 实时营收</span>
                    </div>
                </div>
                <div className="p-2 h-[750px] w-full relative bg-[#e8eef5] rounded-b-2xl overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-slate-400 text-sm">加载数据中…</div>
                    ) : (
                        <ReactECharts option={mapOption}
                            style={{ height: '100%', width: '100%', backgroundColor: '#e8eef5' }}
                            opts={{ renderer: 'canvas' }} notMerge={true} />
                    )}

                    {stats.diagnostic.matchedRecords === 0 && stats.diagnostic.totalRecords > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-rose-100 text-center max-w-sm">
                                <div className="text-4xl mb-4">📍</div>
                                <h4 className="text-lg font-black text-slate-900 mb-2">匹配引擎警告</h4>
                                <p className="text-sm text-slate-500 mb-6">
                                    {hasActiveFilter
                                        ? `筛选条件下无匹配的地理位置记录，请尝试调整筛选条件。`
                                        : `抓取到 ${stats.diagnostic.totalRecords} 条记录，但由于地点名称不匹配，无法在地图映射显示。`}
                                </p>
                                <button onClick={clearFilters}
                                    className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">清除筛选重试</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Top10 商品 & Top10 公司 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 text-sm">商品营收排行</h3>
                        <span className="text-xs text-slate-400">{stats.topProducts.length} 个品类</span>
                    </div>
                    <div className="p-5">
                        {stats.topProducts.length === 0 ? (
                            <p className="text-center text-slate-400 text-sm py-8">暂无数据</p>
                        ) : (
                            <div className="space-y-4">
                                {stats.topProducts.map((item, i) => {
                                    const pct = stats.totalRevenue > 0 ? (item.amount / stats.totalRevenue) * 100 : 0;
                                    const rankColors = ['text-amber-500', 'text-slate-400', 'text-amber-600'];
                                    return (
                                        <div key={item.name}>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`text-xs font-black w-5 shrink-0 ${i < 3 ? rankColors[i] : 'text-slate-300'}`}>{i + 1}</span>
                                                    <span className="text-sm font-medium text-slate-700 truncate">{item.name}</span>
                                                </div>
                                                <span className="text-sm font-black text-slate-800 ml-3 shrink-0 font-mono">
                                                    ¥{item.amount.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mb-1.5 ml-7">
                                                <span className="text-xs text-rose-400 font-medium" title={item.maxMarket}>
                                                    ↑ ¥{item.maxPrice.toFixed(2)}{item.maxMarket ? ` @${getAbbr(item.maxMarket)}` : ''}
                                                </span>
                                                <span className="text-slate-200">|</span>
                                                <span className="text-xs text-emerald-400 font-medium" title={item.minMarket}>
                                                    ↓ ¥{item.minPrice.toFixed(2)}{item.minMarket ? ` @${getAbbr(item.minMarket)}` : ''}
                                                </span>
                                            </div>
                                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden ml-7">
                                                <div className="h-full rounded-full transition-all duration-700"
                                                    style={{
                                                        width: `${pct}%`,
                                                        backgroundColor: i === 0 ? '#3b82f6' : i === 1 ? '#6366f1' : i === 2 ? '#8b5cf6' : '#94a3b8'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {currentUser?.role !== 'client' && (
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-slate-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 text-sm">公司营收排行</h3>
                            <span className="text-xs text-slate-400">{stats.topCompanies.length} 个公司</span>
                        </div>
                        <div className="p-5">
                            {stats.topCompanies.length === 0 ? (
                                <p className="text-center text-slate-400 text-sm py-8">暂无数据</p>
                            ) : (
                                <div className="space-y-3">
                                    {stats.topCompanies.map((item, i) => {
                                        const pct = stats.totalRevenue > 0 ? (item.amount / stats.totalRevenue) * 100 : 0;
                                        const rankColors = ['text-emerald-500', 'text-slate-400', 'text-amber-600'];
                                        return (
                                            <div key={item.name}>
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className={`text-xs font-black w-5 shrink-0 ${i < 3 ? rankColors[i] : 'text-slate-300'}`}>{i + 1}</span>
                                                        <span className="text-sm font-medium text-slate-700 truncate">{item.name}</span>
                                                    </div>
                                                    <span className="text-sm font-black text-slate-800 ml-3 shrink-0 font-mono">
                                                        ¥{item.amount.toLocaleString()}
                                                    </span>
                                                </div>
                                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className="h-full rounded-full transition-all duration-700"
                                                        style={{
                                                            width: `${pct}%`,
                                                            backgroundColor: i === 0 ? '#10b981' : i === 1 ? '#14b8a6' : i === 2 ? '#06b6d4' : '#94a3b8'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
