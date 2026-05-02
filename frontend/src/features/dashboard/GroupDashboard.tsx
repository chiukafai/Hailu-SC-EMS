import React, { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

// Use require or import for JSON. 
import chinaGeoJson from '../../data/china.json';
import marketsDataObj from '../../data/markets.json'; 
import cityCoordsObj from '../../data/city_coordinates.json';
import marketCoordsObj from '../../data/market_coordinates.json';

const marketsData: Record<string, {province: string, city: string}> = marketsDataObj;
const cityCoords: Record<string, [number, number]> = cityCoordsObj;
const marketCoords: Record<string, {province: string, city: string, coordinates: [number, number]}> = marketCoordsObj;

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
    const [stats, setStats] = useState({
        totalRevenue: 0,
        invoicedAmount: 0,
        nonInvoicedAmount: 0,
        settlementRate: 0,
        subsidiaryData: [] as any[],
        mapData: [] as any[],
        diagnostic: {
            totalRecords: 0,
            matchedRecords: 0
        }
    });

    const fetchGlobalStats = async () => {
        // 1. 获取所有贸易记录 (明确指定 FK 以免歧义导致 fetch 失败)
        const { data: records, error } = await supabase.from('invoices')
            .select('*, organizations!invoices_org_id_fkey(name)')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Dashboard Fetch Error (with join):", error);
            // 兜底：如果关联查询失败，尝试简单的单表查询
            const { data: fallbackRecords, error: fallbackError } = await supabase.from('invoices').select('*');
            if (fallbackError) {
                console.error("Dashboard Fetch Error (fallback):", fallbackError);
                return;
            }
            processRecords(fallbackRecords || []);
        } else {
            processRecords(records || []);
        }
    };

    const processRecords = (records: any[]) => {
        if (records) {
            // 用户确认：营收由 数量 * 单价 实时计算
            const getRevenue = (r: any) => (Number(r.quantity) * Number(r.unit_price)) || Number(r.amount) || 0;

            const total = records.reduce((sum, r) => sum + getRevenue(r), 0);
            const invoiced = records.filter(r => r.invoice_status === 'invoiced').reduce((sum, r) => sum + getRevenue(r), 0);
            const settled = records.filter(r => r.transaction_status === 'completed').reduce((sum, r) => sum + getRevenue(r), 0);

            // 2. 按子公司维度聚合
            const subMap = new Map();
            records.forEach(r => {
                const name = r.organizations?.name || '未知单元';
                const current = subMap.get(name) || { name, amount: 0, unsettled: 0 };
                const rev = getRevenue(r);
                current.amount += rev;
                if (r.transaction_status !== 'completed') current.unsettled += rev;
                subMap.set(name, current);
            });

            // 辅助函数：标准化字符串（平衡匹配度）
            const normalize = (s: string) => {
                if (!s) return "";
                // 仅去除末尾极通用的后缀，保留中间的“农产品/中心/批发”等关键词以防误删
                return s.trim().replace(/[省市区县市场]$/g, "");
            };

            // 3. 按市场地理维度聚合 
            const marketMap = new Map();
            let matchedCount = 0;

            records.forEach(r => {
                const loc = r.trade_location?.trim();
                if (!loc) return;
                
                let targetMarket = undefined;

                // Tier 1: 绝对全称匹配 (最高级)
                if (marketCoords[loc]) {
                    targetMarket = loc;
                }

                // Tier 2: 去除空格后的精确匹配
                if (!targetMarket) {
                    targetMarket = Object.keys(marketCoords).find(m => m.trim() === loc);
                }

                // Tier 3: 包含关系或标准化匹配 (退路)
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
                        name: targetMarket, 
                        value: 0, 
                        city: info.city, 
                        province: info.province,
                        coords: info.coordinates
                    };
                    current.value += getRevenue(r);
                    marketMap.set(targetMarket, current);
                }
            });
            setStats({
                totalRevenue: total,
                invoicedAmount: invoiced,
                nonInvoicedAmount: total - invoiced,
                settlementRate: total > 0 ? (settled / total) * 100 : 0,
                subsidiaryData: Array.from(subMap.values()),
                mapData: Array.from(marketMap.values()),
                diagnostic: {
                    totalRecords: records.length,
                    matchedRecords: matchedCount
                }
            });
        }
    };

    useEffect(() => { fetchGlobalStats(); }, []);

    const mapOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#e2e8f0',
            textStyle: { color: '#0f172a', fontWeight: 'bold' },
            formatter: (params: any) => {
                if (params.seriesName === '核心市场') return `<div class="p-1 font-bold text-slate-700">${params.name}</div>`;
                return `<div class="p-1">
                    <div class="text-xs text-slate-500 mb-1">${params.name}</div>
                    <div class="text-sm font-extrabold font-mono" style="color: ${params.color}">¥${params.value[2]?.toLocaleString() || 0}</div>
                </div>`;
            }
        },
        geo: {
            map: 'china',
            roam: true,
            zoom: 1.2,
            itemStyle: {
                areaColor: '#f8fafc',
                borderColor: '#e2e8f0'
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
                zlevel: 1, // 基础点在底层
                data: Object.entries(marketCoords).map(([name, info]) => ({
                    name,
                    value: info.coordinates,
                    city: info.city,
                    province: info.province
                })),
                symbolSize: 8,
                itemStyle: { 
                    color: (params: any) => PROVINCE_COLORS[params.data.province] || PROVINCE_COLORS.DEFAULT,
                    opacity: 0.6, // 降低不透明度，让上层气泡更清晰
                    borderColor: '#fff',
                    borderWidth: 1
                },
                label: {
                    show: false
                },
                tooltip: {
                    show: true,
                    formatter: (p: any) => `<div class="p-1 font-bold text-slate-700">${p.data.name}</div>`
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

            {/* 中国地图营收营收透视 */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden mb-10">
                <div className="p-6 border-b border-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800">全国营收热力透视 (由 19 核心节点穿透)</h3>
                    <div className="flex gap-2 text-[10px] font-bold">
                        <span className="flex items-center gap-1 text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-200"></span> 核心点位</span>
                        <span className="flex items-center gap-1 text-blue-500"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> 实时营收</span>
                    </div>
                </div>
                <div className="p-2 h-[600px] w-full relative">
                    <ReactECharts 
                        option={mapOption} 
                        style={{ height: '100%', width: '100%' }}
                        opts={{ renderer: 'canvas' }}
                        notMerge={true}
                    />
                    
                    {/* 地图视觉层叠修正提示 */}
                    {stats.diagnostic.matchedRecords === 0 && stats.diagnostic.totalRecords > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-rose-100 text-center max-w-sm">
                                <div className="text-4xl mb-4">📍</div>
                                <h4 className="text-lg font-black text-slate-900 mb-2">匹配引擎警告</h4>
                                <p className="text-sm text-slate-500 mb-6">抓取到 {stats.diagnostic.totalRecords} 条记录，但由于地点名称不匹配（如空格、简称差异），无法在地图映射显示。</p>
                                <button onClick={() => fetchGlobalStats()} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">强制重新同步</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 子公司收入排行与风险透视 */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50">
                    <h3 className="font-bold text-slate-800">各经营单元收入与风险透视</h3>
                </div>
                <div className="p-6">
                    <div className="space-y-6">
                        {stats.subsidiaryData.map(sub => (
                            <div key={sub.name} className="relative">
                                <div className="flex justify-between mb-2 text-sm">
                                    <span className="font-bold text-slate-700">{sub.name}</span>
                                    <span className="text-slate-400 text-xs">
                                        营收: <span className="text-slate-900 font-black">¥{sub.amount.toLocaleString()}</span> |
                                        风险: <span className="text-rose-500 font-black">¥{sub.unsettled.toLocaleString()}</span>
                                    </span>
                                </div>
                                <div className="h-4 bg-slate-50 rounded-full overflow-hidden flex shadow-inner">
                                    <div className="h-full bg-blue-500 transition-all duration-1000 relative group" style={{ width: `${(sub.amount / stats.totalRevenue) * 100}%` }}>
                                        <div className="absolute right-0 top-0 bottom-0 bg-white/30 w-px"></div>
                                    </div>
                                    <div className="h-full bg-rose-200 transition-all duration-1000" style={{ width: `${(sub.unsettled / stats.totalRevenue) * 100}%` }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}