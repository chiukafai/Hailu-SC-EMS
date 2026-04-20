import { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

// Use require or import for JSON.
import chinaGeoJson from '../../data/china.json';
import marketCoordsObj from '../../data/market_coordinates.json';
import marketAbbrObj from '../../data/market_abbreviations.json';

const marketCoords = marketCoordsObj as unknown as Record<string, {province: string, city: string, coordinates: [number, number]}>;
const MARKET_ABBR: Record<string, string> = marketAbbrObj as Record<string, string>;
const getAbbr = (market: string) => MARKET_ABBR[market] || market;

const PROVINCE_COLORS: Record<string, string> = {
    "广东": "#3b82f6", // blue
    "四川": "#ec4899", // pink
    "海南": "#10b981", // emerald
    "安徽": "#f59e0b", // amber
    "江西": "#8b5cf6", // violet
    "江苏": "#14b8a6", // teal
    "福建": "#f43f5e", // rose
    "上海": "#6366f1", // indigo
    "天津": "#06b6d4", // cyan
    "湖北": "#eab308", // yellow
    "陕西": "#84cc16", // lime
    "湖南": "#d946ef", // fuchsia
    "河南": "#0ea5e9", // sky
    "重庆": "#f97316", // orange
    "DEFAULT": "#4f46e5"
};

echarts.registerMap('china', chinaGeoJson as any);

export default function GroupDashboard() {
    const [rawRecords, setRawRecords] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // ── 筛选器状态 ──────────────────────────────────────────────
    const [filterMarket, setFilterMarket] = useState('');
    const [filterProduct, setFilterProduct] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');

    // ── 派生选项（从原始数据提取） ──────────────────────────────
    const marketOptions = [...new Set(rawRecords.map(r => r.trade_location?.trim()).filter(Boolean))].sort();
    const productOptions = [...new Set(rawRecords.map(r => r.product_info?.trim()).filter(Boolean))].sort();

    // ── 营收计算函数 ────────────────────────────────────────────
    const getRevenue = (r: any) => (Number(r.quantity) * Number(r.unit_price)) || Number(r.amount) || 0;

    // ── 筛选后的记录 ────────────────────────────────────────────
    const filteredRecords = rawRecords.filter(r => {
        if (filterMarket && r.trade_location?.trim() !== filterMarket) return false;
        if (filterProduct && r.product_info?.trim() !== filterProduct) return false;
        if (filterDateFrom && r.trade_date < filterDateFrom) return false;
        if (filterDateTo && r.trade_date > filterDateTo) return false;
        return true;
    });

    // ── 核心统计数据（基于筛选后数据） ─────────────────────────
    const stats = (() => {
        if (!filteredRecords.length) return {
            totalRevenue: 0, invoicedAmount: 0, nonInvoicedAmount: 0,
            settlementRate: 0, mapData: [], topProducts: [], topCompanies: [],
            diagnostic: { totalRecords: 0, matchedRecords: 0 }
        };

        const total = filteredRecords.reduce((sum, r) => sum + getRevenue(r), 0);
        const invoiced = filteredRecords.filter(r => r.invoice_status === '已开票').reduce((sum, r) => sum + getRevenue(r), 0);
        const settled = filteredRecords.filter(r => r.transaction_status === '已走流水').reduce((sum, r) => sum + getRevenue(r), 0);

        // ── Top10 商品（含价格区间） ──────────────────────────
        const productMap = new Map<string, { amount: number; maxPrice: number; maxMarket: string; maxDate: string; minPrice: number; minMarket: string; minDate: string }>();
        filteredRecords.forEach(r => {
            const p = r.product_info?.trim() || '未分类';
            const price = Number(r.unit_price) || 0;
            const loc = r.trade_location?.trim() || '';
            const date = r.trade_date || '';
            if (!productMap.has(p)) {
                productMap.set(p, { amount: 0, maxPrice: price, maxMarket: loc, maxDate: date, minPrice: price, minMarket: loc, minDate: date });
            }
            const entry = productMap.get(p)!;
            entry.amount += getRevenue(r);
            if (price > entry.maxPrice) { entry.maxPrice = price; entry.maxMarket = loc; entry.maxDate = date; }
            if (price > 0 && (entry.minPrice === 0 || price < entry.minPrice)) { entry.minPrice = price; entry.minMarket = loc; entry.minDate = date; }
        });
        const topProducts = [...productMap.entries()]
            .sort((a, b) => b[1].amount - a[1].amount)
            .slice(0, 10)
            .map(([name, d]) => ({ name, amount: d.amount, maxPrice: d.maxPrice, maxMarket: d.maxMarket, maxDate: d.maxDate, minPrice: d.minPrice, minMarket: d.minMarket, minDate: d.minDate }));

        // ── Top10 公司 ────────────────────────────────────────
        const companyMap = new Map<string, number>();
        filteredRecords.forEach(r => {
            const name = r.organizations?.name || '未知单元';
            companyMap.set(name, (companyMap.get(name) || 0) + getRevenue(r));
        });
        const topCompanies = [...companyMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, amount]) => ({ name, amount }));

        // ── 地图地理维度 ──────────────────────────────────────
        const normalize = (s: string) => s.trim().replace(/[省市区县市场]$/g, "");
        const marketMap = new Map();
        let matchedCount = 0;
        filteredRecords.forEach(r => {
            const loc = r.trade_location?.trim();
            if (!loc) return;
            let targetMarket: string | undefined;
            if (marketCoords[loc]) targetMarket = loc;
            if (!targetMarket) targetMarket = Object.keys(marketCoords).find(m => m.trim() === loc);
            if (!targetMarket) {
                const normLoc = normalize(loc);
                targetMarket = Object.keys(marketCoords).find(m => {
                    const normM = normalize(m);
                    return normM === normLoc || m.includes(loc) || loc.includes(m);
                });
            }
            if (targetMarket) {
                matchedCount++;
                const info = marketCoords[targetMarket];
                const current = marketMap.get(targetMarket) || {
                    name: targetMarket, value: 0, city: info.city,
                    province: info.province, coords: info.coordinates
                };
                current.value += getRevenue(r);
                marketMap.set(targetMarket, current);
            }
        });

        return {
            totalRevenue: total,
            invoicedAmount: invoiced,
            nonInvoicedAmount: total - invoiced,
            settlementRate: total > 0 ? (settled / total) * 100 : 0,
            mapData: Array.from(marketMap.values()),
            topProducts,
            topCompanies,
            diagnostic: { totalRecords: filteredRecords.length, matchedRecords: matchedCount }
        };
    })();

    const fetchGlobalStats = async () => {
        setLoading(true);
        const { data: records, error } = await supabase.from('invoices')
            .select('*, organizations!invoices_org_id_fkey(name)')
            .order('trade_date', { ascending: false });

        if (error) {
            console.error("Dashboard Fetch Error:", error);
            const { data: fallback } = await supabase.from('invoices').select('*');
            setRawRecords(fallback || []);
        } else {
            setRawRecords(records || []);
        }
        setLoading(false);
    };

    const clearFilters = () => {
        setFilterMarket(''); setFilterProduct(''); setFilterDateFrom(''); setFilterDateTo('');
    };

    const hasActiveFilter = filterMarket || filterProduct || filterDateFrom || filterDateTo;

    useEffect(() => { fetchGlobalStats(); }, []);

    const refresh = () => { fetchGlobalStats(); };

    const mapOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255, 255, 255, 0.97)',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            textStyle: { color: '#0f172a' },
            formatter: (params: any) => {
                if (params.seriesName === '核心市场') return `<div class="p-2 font-bold text-slate-700">${params.name}<br/><span class="text-xs font-normal text-slate-400">${params.data.city} · ${params.data.province}</span></div>`;
                const loc = params.name;
                // 从筛选后的记录中聚合该市场的商品明细
                const marketRecords = filteredRecords.filter(r => r.trade_location?.trim() === loc);
                const productMap = new Map<string, number>();
                marketRecords.forEach(r => {
                    const p = r.product_info?.trim() || '未分类';
                    productMap.set(p, (productMap.get(p) || 0) + getRevenue(r));
                });
                const total = params.value[2] || 0;
                let productHtml = '';
                if (productMap.size > 1) {
                    const sorted = [...productMap.entries()].sort((a, b) => b[1] - a[1]);
                    productHtml = '<div class="mt-2 pt-2 border-t border-slate-100">'
                        + sorted.slice(0, 5).map(([p, v]) =>
                            `<div class="flex justify-between text-xs gap-4 py-0.5"><span class="text-slate-500 truncate max-w-[120px]">${p}</span><span class="font-mono font-bold text-slate-700">¥${v.toLocaleString()}</span></div>`
                        ).join('')
                        + (sorted.length > 5 ? `<div class="text-xs text-slate-400 mt-1">+${sorted.length - 5} 个商品</div>` : '')
                        + '</div>';
                } else if (marketRecords[0]?.product_info) {
                    productHtml = `<div class="text-xs text-slate-400 mt-1">${marketRecords[0].product_info.trim()}</div>`;
                }
                return `<div class="p-2 min-w-[180px]">
                    <div class="font-bold text-slate-700 text-sm">${params.name}</div>
                    <div class="text-xs text-slate-400 mb-1">${params.data.city} · ${params.data.province}</div>
                    <div class="text-xl font-extrabold font-mono mt-1" style="color:${params.color}">¥${total.toLocaleString()}</div>
                    <div class="text-xs text-slate-400">${marketRecords.length} 条记录</div>
                    ${productHtml}
                </div>`;
            }
        },
        geo: {
            map: 'china',
            roam: true,
            zoom: 1.2,
            backgroundColor: '#e8eef5',   // 地图外背景：淡蓝灰，与陆地白色形成对比
            itemStyle: {
                areaColor: '#ffffff',     // 陆地：白色
                borderColor: '#cbd5e1'
            },
            emphasis: {
                itemStyle: { areaColor: '#f1f5f9' }
            },
            regions: Object.entries(PROVINCE_COLORS).map(([name, color]) => ({
                name,
                itemStyle: {
                    areaColor: name === 'DEFAULT' ? '#f8fafc' : `${color}15` // Extremely light tint for province
                }
            }))
        },
        series: [
            {
                name: '核心市场',
                type: 'scatter',
                coordinateSystem: 'geo',
                zlevel: 1,
                data: Object.entries(marketCoords).map(([name, info]) => ({
                    name,
                    value: info.coordinates,
                    city: info.city,
                    province: info.province
                })),
                symbolSize: 8,
                itemStyle: {
                    color: (params: any) => PROVINCE_COLORS[params.data.province] || PROVINCE_COLORS.DEFAULT,
                    opacity: 0.6,
                    borderColor: '#fff',
                    borderWidth: 1
                },
                label: { show: false },
                tooltip: {
                    show: true,
                    formatter: (p: any) => `<div class="p-2 font-bold text-slate-700">${p.data.name}<br/><span class="text-xs font-normal text-slate-400">${p.data.city} · ${p.data.province}</span></div>`
                },
                silent: false
            },
            {
                name: '营收气泡',
                type: 'effectScatter',
                coordinateSystem: 'geo',
                zlevel: 10, // 气泡置于最上层
                rippleEffect: {
                    brushType: 'stroke',
                    scale: 3
                },
                data: stats.mapData.map(item => ({
                    name: item.name,
                    province: item.province,
                    value: [
                        item.coords[0],
                        item.coords[1],
                        item.value
                    ],
                    itemStyle: {
                        color: PROVINCE_COLORS[item.province] || PROVINCE_COLORS.DEFAULT,
                        shadowBlur: 10,
                        shadowColor: 'rgba(0,0,0,0.3)'
                    }
                })),
                symbolSize: (val: any) => {
                    if (!stats.totalRevenue) return 10;
                    const ratio = val[2] / stats.totalRevenue;
                    // 确保即使是非常小的比例，气泡也清晰可见 (最小10px)
                    return Math.max(10, Math.min(35, ratio * 150)); 
                },
                itemStyle: {
                    opacity: 0.9
                }
            }
        ]
    };

    return (
        <div className="p-8 max-w-7xl mx-auto animate-in fade-in duration-1000">
            <div className="flex justify-between items-end mb-8 relative">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">集团财务概览</h2>
                    <p className="text-slate-500 mt-1 text-sm">实时汇总全集团 100+ 经营单元贸易数据</p>
                </div>
                
                {/* 实时数据诊断面板 */}
                <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl border border-slate-700 flex gap-6 items-center scale-90 origin-right transition-all hover:scale-100">
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest">物理记录</span>
                        <span className="text-lg font-black font-mono">{(stats.diagnostic.totalRecords).toString().padStart(2, '0')}</span>
                    </div>
                    <div className="w-px h-8 bg-slate-700"></div>
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-black text-emerald-500 tracking-widest">成功匹配</span>
                        <span className="text-lg font-black font-mono text-emerald-400">{(stats.diagnostic.matchedRecords).toString().padStart(2, '0')}</span>
                    </div>
                    <div className="w-px h-8 bg-slate-700"></div>
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-black text-blue-500 tracking-widest">映射率</span>
                        <span className="text-lg font-black font-mono text-blue-400">
                            {stats.diagnostic.totalRecords > 0 ? Math.round((stats.diagnostic.matchedRecords/stats.diagnostic.totalRecords)*100) : 0}%
                        </span>
                    </div>
                </div>
            </div>

            {/* 筛选工具栏 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mb-6">
                <div className="flex items-center gap-3 flex-wrap">
                    {/* 市场筛选 */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">市场</label>
                        <select
                            value={filterMarket}
                            onChange={e => setFilterMarket(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[140px]"
                        >
                            <option value="">全部市场</option>
                            {marketOptions.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>

                    {/* 商品筛选 */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">商品</label>
                        <select
                            value={filterProduct}
                            onChange={e => setFilterProduct(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[140px]"
                        >
                            <option value="">全部商品</option>
                            {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>

                    {/* 日期范围 */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">日期</label>
                        <input
                            type="date"
                            value={filterDateFrom}
                            onChange={e => setFilterDateFrom(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <span className="text-slate-400 text-sm">~</span>
                        <input
                            type="date"
                            value={filterDateTo}
                            onChange={e => setFilterDateTo(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                    </div>

                    {/* 操作按钮 */}
                    <button
                        onClick={clearFilters}
                        className={`ml-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${hasActiveFilter ? 'border-rose-200 text-rose-500 hover:bg-rose-50' : 'border-slate-200 text-slate-300 cursor-not-allowed'}`}
                        disabled={!hasActiveFilter}
                    >
                        清除筛选
                    </button>

                    <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                        <span className="font-mono">{stats.diagnostic.totalRecords} 条记录</span>
                        {loading && <span className="text-blue-500 animate-pulse">加载中…</span>}
                    </div>
                </div>
            </div>

            {/* 核心指标卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">累计营业收入</p>
                    <p className="text-2xl font-black text-slate-900 mt-2">¥{stats.totalRevenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">已确认开票</p>
                    <p className="text-2xl font-black text-blue-600 mt-2">¥{stats.invoicedAmount.toLocaleString()}</p>
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
                            <span className="bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">
                                已筛选
                            </span>
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
                        <ReactECharts
                            option={mapOption}
                            style={{ height: '100%', width: '100%', backgroundColor: '#e8eef5' }}
                            opts={{ renderer: 'canvas' }}
                            notMerge={true}
                        />
                    )}

                    {/* 无匹配警告 */}
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
                                <button onClick={clearFilters} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">清除筛选重试</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Top10 商品 & Top10 公司 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 左栏：商品排行 */}
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
                                                    <span className={`text-xs font-black w-5 shrink-0 ${i < 3 ? rankColors[i] : 'text-slate-300'}`}>
                                                        {i + 1}
                                                    </span>
                                                    <span className="text-sm font-medium text-slate-700 truncate">{item.name}</span>
                                                </div>
                                                <span className="text-sm font-black text-slate-800 ml-3 shrink-0 font-mono">
                                                    ¥{item.amount.toLocaleString()}
                                                </span>
                                            </div>
                                            {/* 价格区间 */}
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
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
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

                {/* 右栏：公司营收排行 */}
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
                                    const rankColors = ['text-amber-500', 'text-slate-400', 'text-amber-600'];
                                    return (
                                        <div key={item.name}>
                                            <div className="flex justify-between items-center mb-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`text-xs font-black w-5 shrink-0 ${i < 3 ? rankColors[i] : 'text-slate-300'}`}>
                                                        {i + 1}
                                                    </span>
                                                    <span className="text-sm font-medium text-slate-700 truncate">{item.name}</span>
                                                </div>
                                                <span className="text-sm font-black text-slate-800 ml-3 shrink-0 font-mono">
                                                    ¥{item.amount.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
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
            </div>
        </div>
    );
}