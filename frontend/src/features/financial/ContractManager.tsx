import React, { useState, useEffect } from 'react';
import { supabase } from '../../api/supabase';
import type { Contract, ContractStatus, ContractType } from '../../types';
import * as XLSX from 'xlsx';
import PizZip from 'pizzip';

// ════════════════════════════════════════════════════════════════════
// 合同模板商品明细 XML 注入工具（docxtemplater 无法处理多行表格）
// 模板：购销合同模板_utf8.docx（UTF-8 编码）
// 表格结构：行0=表头(品种/单位/单价/数量/金额)，行1=数据行(公斤占位)
// docxtemplater 渲染时不传商品明细 → Cell 0-4 需手动注入数据
// ════════════════════════════════════════════════════════════════════

function xmlText(raw: unknown): string {
  if (raw == null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 新模板注入函数：按 Cell 顺序注入商品数据
 * 表格5列：Cell0=品种(空→商品名), Cell1=单位(公斤→商品名),
 *          Cell2=单价(空→单价), Cell3=数量(空→数量), Cell4=金额(空→金额)
 */
function injectTextToRowCells(rowXml: string, invoice: {
  product_info?: string; quantity?: number; unit_price?: number; amount?: number;
}) {
  const vals = [
    xmlText(invoice.product_info || ''),           // Cell 0 - 品种
    xmlText(invoice.product_info || '公斤'),      // Cell 1 - 单位（替换公斤）
    invoice.quantity != null ? String(invoice.quantity) : '',      // Cell 2 - 数量
    invoice.unit_price != null ? invoice.unit_price.toFixed(2) : '', // Cell 3 - 单价
    invoice.amount != null
      ? invoice.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
      : '',                                       // Cell 4 - 金额
  ];

  // 提取5个单元格
  const cells: string[] = [];
  let cp = 0;
  while ((cp = rowXml.indexOf('<w:tc>', cp)) !== -1) {
    const ce = rowXml.indexOf('</w:tc>', cp) + 7;
    cells.push(rowXml.substring(cp, ce));
    cp = ce;
  }
  if (cells.length !== 5) return rowXml;

  // Cell 0: 注入商品名（空单元格 → 追加 run）
  let cell0 = cells[0];
  const p0 = cell0.indexOf('</w:p>');
  if (p0 !== -1) {
    cell0 = cell0.substring(0, p0) + `<w:r><w:t>${vals[0]}</w:t></w:r>` + cell0.substring(p0);
  }

  // Cell 1: 替换"公斤"为商品名
  let cell1 = cells[1].replace('<w:t>公斤</w:t>', `<w:t>${vals[1]}</w:t>`);

  // Cell 2-4: 注入数值（追加 run 到空段落）
  let cell2 = cells[2];
  const p2 = cell2.indexOf('</w:p>');
  if (p2 !== -1) {
    cell2 = cell2.substring(0, p2) + `<w:r><w:t>${vals[2]}</w:t></w:r>` + cell2.substring(p2);
  }

  let cell3 = cells[3];
  const p3 = cell3.indexOf('</w:p>');
  if (p3 !== -1) {
    cell3 = cell3.substring(0, p3) + `<w:r><w:t>${vals[3]}</w:t></w:r>` + cell3.substring(p3);
  }

  let cell4 = cells[4];
  const p4 = cell4.indexOf('</w:p>');
  if (p4 !== -1) {
    cell4 = cell4.substring(0, p4) + `<w:r><w:t>${vals[4]}</w:t></w:r>` + cell4.substring(p4);
  }

  const trTagEnd = rowXml.indexOf('>');
  const trOpenTag = rowXml.substring(0, trTagEnd + 1);
  return trOpenTag + cell0 + cell1 + cell2 + cell3 + cell4 + '</w:tr>';
}

function injectInvoiceRowsIntoDocXml(
  xmlStr: string,
  invoiceRows: { product_info?: string; quantity?: number; unit_price?: number; amount?: number }[]
): string {
  const tblStart = xmlStr.indexOf('<w:tbl>');
  if (tblStart === -1) return xmlStr;
  const tblEnd = xmlStr.indexOf('</w:tbl>') + 8;
  const tbl = xmlStr.substring(tblStart, tblEnd);

  // 定位第2行（rowIdx=1 = 数据行）
  let rp = 0, rowIdx = 0;
  let dataRowStart = -1, dataRowEnd = -1;
  while ((rp = tbl.indexOf('<w:tr', rp)) !== -1) {
    const re = tbl.indexOf('</w:tr>', rp) + 7;
    if (rowIdx === 1) { dataRowStart = rp; dataRowEnd = re; break; }
    rowIdx++;
    rp = re;
  }
  if (dataRowStart === -1) return xmlStr;

  const dataRowXml = tbl.substring(dataRowStart, dataRowEnd);
  const newRows = invoiceRows.map(inv => injectTextToRowCells(dataRowXml, inv));

  return xmlStr.substring(0, tblStart + dataRowStart) + newRows.join('') + xmlStr.substring(tblStart + dataRowEnd);
}
import Docxtemplater from 'docxtemplater';

const STATUS_COLORS: Record<ContractStatus, string> = {
  '草稿':   'bg-slate-100 text-slate-600',
  '待签署': 'bg-amber-100 text-amber-700',
  '已签署': 'bg-blue-100 text-blue-700',
  '已履行': 'bg-emerald-100 text-emerald-700',
  '已终止': 'bg-rose-100 text-rose-600',
};

const CONTRACT_TYPES: ContractType[] = ['采购合同', '销售合同', '服务合同', '框架协议', '其他'];
const CONTRACT_STATUSES: ContractStatus[] = ['草稿', '待签署', '已签署', '已履行', '已终止'];

const initialForm = {
  contract_no: '',
  contract_name: '',
  contract_type: '' as ContractType | '',
  party_a_name: '',
  party_b_name: '',
  amount: '',
  signed_at: '',
  effective_at: '',
  expired_at: '',
  status: '草稿' as ContractStatus,
  remarks: '',
};

export default function ContractManager({
  permissionLevel = 'edit',
  currentUser,
}: {
  permissionLevel?: string;
  currentUser?: { username: string; role: string };
}) {
  const canEdit = permissionLevel === 'edit' || permissionLevel === 'admin';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [totalCount, setTotalCount] = useState(0);       // 【新增】服务端返回的总数
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [searchFilters, setSearchFilters] = useState({
    contract_name: '',
    party_a_name: '',
    party_b_name: '',
    status: '',
    contract_type: '',
    date_start: '',
    date_end: '',
  });

  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter change + auto-refetch
  useEffect(() => { setCurrentPage(1); fetchContracts(); }, [searchFilters]);
  useEffect(() => { fetchContracts(); }, [currentPage, pageSize]);

  // 【优化】使用服务端分页 + 服务端过滤，替代原来 select('*') 全量拉取
  const fetchContracts = async () => {
    setLoading(true);
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('contracts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // 搜索条件转为服务端过滤
    const { contract_name, party_a_name, party_b_name, status, contract_type, date_start, date_end } = searchFilters;
    if (contract_name) query = query.ilike('contract_name', `%${contract_name}%`);
    if (party_a_name) query = query.ilike('party_a_name', `%${party_a_name}%`);
    if (party_b_name) query = query.ilike('party_b_name', `%${party_b_name}%`);
    if (status) query = query.eq('status', status);
    if (contract_type) query = query.eq('contract_type', contract_type);
    if (date_start) query = query.gte('signed_at', date_start);
    if (date_end) query = query.lte('signed_at', date_end);

    const { data, count, error } = await query;
    if (error) {
      console.error('Fetch contracts error:', error);
      setContracts([]);
      setTotalCount(0);
    } else {
      setContracts((data ?? []) as Contract[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => { fetchContracts(); }, []); // 初始加载

  // 【优化】服务端已处理全部过滤+分页，直接透传
  const displayContracts = contracts;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const totalAmount = displayContracts.reduce((sum, c) => sum + (c.amount || 0), 0);

  const openNew = () => {
    setEditingId(null);
    setFormData(initialForm);
    setIsModalOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditingId(c.id);
    setFormData({
      contract_no:    c.contract_no,
      contract_name:  c.contract_name,
      contract_type:  c.contract_type || '',
      party_a_name:   c.party_a_name || '',
      party_b_name:   c.party_b_name || '',
      amount:         c.amount != null ? String(c.amount) : '',
      signed_at:      c.signed_at || '',
      effective_at:   c.effective_at || '',
      expired_at:     c.expired_at || '',
      status:         c.status,
      remarks:        c.remarks || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.contract_no.trim() || !formData.contract_name.trim()) return;
    setSaving(true);
    const payload = {
      contract_no:   formData.contract_no.trim(),
      contract_name: formData.contract_name.trim(),
      contract_type: formData.contract_type || null,
      party_a_name:  formData.party_a_name.trim() || null,
      party_b_name:  formData.party_b_name.trim() || null,
      amount:        formData.amount !== '' ? parseFloat(formData.amount) : null,
      signed_at:     formData.signed_at || null,
      effective_at:  formData.effective_at || null,
      expired_at:    formData.expired_at || null,
      status:        formData.status,
      remarks:       formData.remarks.trim() || null,
      created_by:    currentUser?.username || null,
    };
    if (editingId) {
      await supabase.from('contracts').update(payload).eq('id', editingId);
    } else {
      await supabase.from('contracts').insert(payload);
    }
    setSaving(false);
    setIsModalOpen(false);
    fetchContracts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该合同？此操作不可撤销。')) return;
    await supabase.from('contracts').delete().eq('id', id);
    fetchContracts();
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条合同？`)) return;
    await supabase.from('contracts').delete().in('id', [...selectedIds]);
    setSelectedIds(new Set());
    fetchContracts();
  };

  const handleExport = async () => {
    // 导出当前筛选条件下的全部数据（临时无分页查询）
    let exportList: Contract[];
    if (totalCount <= pageSize) {
      // 当前页已是全部数据
      exportList = displayContracts;
    } else {
      // 需要单独拉取全量
      let query = supabase.from('contracts').select('*').order('created_at', { ascending: false });
      const { contract_name, party_a_name, party_b_name, status, contract_type, date_start, date_end } = searchFilters;
      if (contract_name) query = query.ilike('contract_name', `%${contract_name}%`);
      if (party_a_name) query = query.ilike('party_a_name', `%${party_a_name}%`);
      if (party_b_name) query = query.ilike('party_b_name', `%${party_b_name}%`);
      if (status) query = query.eq('status', status);
      if (contract_type) query = query.eq('contract_type', contract_type);
      if (date_start) query = query.gte('signed_at', date_start);
      if (date_end) query = query.lte('signed_at', date_end);
      const { data } = await query;
      exportList = (data ?? []) as Contract[];
    }
    const rows = exportList.map(c => ({
      '合同编号': c.contract_no,
      '合同名称': c.contract_name,
      '合同类型': c.contract_type || '',
      '甲方':     c.party_a_name || '',
      '乙方':     c.party_b_name || '',
      '合同金额': c.amount ?? '',
      '签订日期': c.signed_at || '',
      '生效日期': c.effective_at || '',
      '到期日期': c.expired_at || '',
      '状态':     c.status,
      '备注':     c.remarks || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '合同列表');
    XLSX.writeFile(wb, `合同列表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`);
  };

  // ─── 合同生成 ───────────────────────────────────────────────
  const [genModal, setGenModal] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');

  // 甲乙方候选：organizations + global_clients 合并
  // source 区分来源：'org' | 'client'
  const [orgOptions, setOrgOptions] = useState<{ id: string; name: string; source: 'org' | 'client'; taxId: string }[]>([]);
  // 关键字搜索输入（与已选ID分离）
  const [partyASearch, setPartyASearch] = useState('');
  const [partyBSearch, setPartyBSearch] = useState('');
  // 下拉展开状态
  const [showPartyADropdown, setShowPartyADropdown] = useState(false);
  const [showPartyBDropdown, setShowPartyBDropdown] = useState(false);
  // 动态搜索结果（服务端按关键字过滤，避免全量加载截断问题）
  const [filteredPartyA, setFilteredPartyA] = useState<{ id: string; name: string; source: 'org' | 'client'; taxId: string }[]>([]);
  const [filteredPartyB, setFilteredPartyB] = useState<{ id: string; name: string; source: 'org' | 'client'; taxId: string }[]>([]);

  // 按关键字动态搜索甲/乙方候选（服务端 ilike，解决前端全量截断问题）
  const searchPartyOptions = async (keyword: string): Promise<{ id: string; name: string; source: 'org' | 'client'; taxId: string }[]> => {
    if (!keyword.trim()) {
      // 无关键字时返回预加载的全量 orgOptions（集团公司 + 客户前1000条）
      return orgOptions;
    }
    const kw = `%${keyword}%`;
    const [orgsRes, clientsRes] = await Promise.all([
      supabase.from('organizations').select('id, name').ilike('name', kw).order('name').limit(30),
      supabase.from('global_clients').select('id, full_name, tax_id').ilike('full_name', kw).order('full_name').limit(30),
    ]);
    const orgs = (orgsRes.data ?? []).map(o => ({ id: o.id, name: o.name, source: 'org' as const, taxId: '' }));
    const clients = (clientsRes.data ?? []).map(c => ({ id: c.id, name: c.full_name, source: 'client' as const, taxId: c.tax_id || '' }));
    return [...orgs, ...clients];
  };

  // 合同生成表单
  // 注：贸易数据中甲方=卖方（对应 invoices.org_id），乙方=买方（对应 invoices.client_org_id）
  const [genForm, setGenForm] = useState({
    party_a: '',   // 甲方（卖方/供应方）
    party_b: '',   // 乙方（买方/购买方）
    date_start: '',
    date_end: '',
  });
  // 已选公司的完整信息（直接从下拉选中时记录，不依赖 orgOptions 反查——
  // 因为服务端搜索结果不在 orgOptions 里，反查会丢失名称）
  const [partyASelected, setPartyASelected] = useState<{ id: string; name: string; source: 'org' | 'client'; taxId: string } | null>(null);
  const [partyBSelected, setPartyBSelected] = useState<{ id: string; name: string; source: 'org' | 'client'; taxId: string } | null>(null);
  const partyASelectedName = partyASelected?.name || '';
  const partyBSelectedName = partyBSelected?.name || '';
  // 贸易汇总预览
  const [tradePreview, setTradePreview] = useState<{
    totalRaw: number;
    totalRounded: number;
    count: number;
    dateRange: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 加载候选列表：organizations（集团公司）+ global_clients（合作客户）合并
  useEffect(() => {
    if (!genModal) return;
    Promise.all([
      supabase.from('organizations').select('id, name').order('name'),
      supabase.from('global_clients').select('id, full_name, tax_id').order('full_name'),
    ]).then(([orgsRes, clientsRes]) => {
      const orgs = (orgsRes.data ?? []).map(o => ({ id: o.id, name: o.name, source: 'org' as const, taxId: '' }));
      const clients = (clientsRes.data ?? []).map(c => ({ id: c.id, name: c.full_name, source: 'client' as const, taxId: c.tax_id || '' }));
      // 合并，org 优先展示
      setOrgOptions([...orgs, ...clients]);
    });
  }, [genModal]);

  // 取整到最近整千
  const roundToThousand = (n: number) => Math.round(n / 1000) * 1000;

  // 将数字转为中文大写金额（简化版）
  const toChinaAmount = (n: number): string => {
    if (!n) return '零元整';
    const units = ['', '拾', '佰', '仟', '万', '拾万', '佰万', '仟万', '亿'];
    const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const str = Math.round(n).toString();
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const d = parseInt(str[i]);
      const unitIdx = str.length - 1 - i;
      if (d !== 0) result += digits[d] + units[unitIdx];
      else if (result && !result.endsWith('零')) result += '零';
    }
    result = result.replace(/零+$/, '');
    return result + '元整';
  };

  // 查询并预览贸易数据
  const handlePreviewTrade = async () => {
    if (!genForm.party_a || !genForm.party_b || !genForm.date_start || !genForm.date_end) return;
    setPreviewLoading(true);
    setTradePreview(null);
    setGenError('');
    try {
      // 根据来源确定乙方查询字段：
      //   - 集团公司（org）→ invoices.client_org_id
      //   - 合作客户（client）→ invoices.client_tax_id（用 tax_id 关联）
      const partyBOption = partyBSelected;

      let q = supabase
        .from('invoices')
        .select('amount, trade_date, project_name, product_info, quantity, unit_price')
        .gte('trade_date', genForm.date_start)
        .lte('trade_date', genForm.date_end);

      // 甲方：集团公司 → org_id
      if (genForm.party_a) q = q.eq('org_id', genForm.party_a);

      // 乙方：按来源走不同字段
      if (partyBOption) {
        if (partyBOption.source === 'org') {
          q = q.eq('client_org_id', partyBOption.id);
        } else {
          // 合作客户，用 tax_id 匹配 client_tax_id
          if (partyBOption.taxId) {
            q = q.eq('client_tax_id', partyBOption.taxId);
          }
        }
      }

      const { data, error } = await q;
      if (error) { setGenError('查询贸易数据失败: ' + error.message); return; }

      const rows = data ?? [];
      const totalRaw = rows.reduce((s, r) => s + (r.amount || 0), 0);
      const totalRounded = roundToThousand(totalRaw);

      setTradePreview({
        totalRaw,
        totalRounded,
        count: rows.length,
        dateRange: `${genForm.date_start} 至 ${genForm.date_end}`,
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  // 生成合同 docx
  const handleGenerateContract = async () => {
    if (!genForm.party_a || !genForm.party_b || !genForm.date_start || !genForm.date_end) {
      setGenError('请先填写完整信息并查询贸易明细');
      return;
    }
    setGenLoading(true);
    setGenError('');
    try {
      const partyAName = partyASelected?.name || genForm.party_a;
      const partyBName = partyBSelected?.name || genForm.party_b;

      // ── 重新查询明细行（含商品字段）───────────────────────────────
      const partyBOption = partyBSelected;
      let q = supabase
        .from('invoices')
        .select('amount, product_info, quantity, unit_price')
        .gte('trade_date', genForm.date_start)
        .lte('trade_date', genForm.date_end);
      if (genForm.party_a) q = q.eq('org_id', genForm.party_a);
      if (partyBOption) {
        if (partyBOption.source === 'org') q = q.eq('client_org_id', partyBOption.id);
        else if (partyBOption.taxId) q = q.eq('client_tax_id', partyBOption.taxId);
      }
      const { data: rawRows } = await q;
      const rows = rawRows ?? [];

      const totalRaw = rows.reduce((s, r) => s + (r.amount || 0), 0);
      const totalRounded = roundToThousand(totalRaw);

      // 生成合同编号
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const contractNo = `HLS-${dateStr}-${Math.floor(Math.random() * 9000 + 1000)}`;

      // 中文大写金额
      const amountCN = toChinaAmount(totalRounded);
      const amountNum = totalRounded.toLocaleString('zh-CN');

      // 签署日期
      const signDate = today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

      // fetch 合同模板文件
      const resp = await fetch('/购销合同模板_utf8.docx');
      if (!resp.ok) throw new Error('无法加载合同模板文件');
      const arrayBuf = await resp.arrayBuffer();

      const zip = new PizZip(arrayBuf);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },   // docxtemplater 3.x 默认分隔符变更，需显式指定
      });

      // docxtemplater 渲染（不传商品明细 → 数据行留下 undefined 占位符）
      doc.render({
        合同编号: contractNo,
        甲方: partyAName,
        乙方: partyBName,
        开始日期: genForm.date_start,
        结束日期: genForm.date_end,
        签署日期: signDate,
      });

      // ── UTF-8 编码链：asBinary() → Uint8Array → TextDecoder → 字符串替换 → TextEncoder → Uint8Array → PizZip ──
      // 模板为 UTF-8 编码，无需 iconv，直接走 PizZip Uint8Array 通道
      const xmlBin = doc.getZip().files['word/document.xml'].asBinary();
      const xmlBytes = new Uint8Array(xmlBin.length);
      for (let i = 0; i < xmlBin.length; i++) xmlBytes[i] = xmlBin.charCodeAt(i);
      const xmlStrUtf8 = new TextDecoder('utf-8').decode(xmlBytes);

      const xmlStrInjected = injectInvoiceRowsIntoDocXml(xmlStrUtf8, rows);

      // UTF-8 → Uint8Array，直接传给 PizZip（不转 binary string）
      const outBytes = new TextEncoder().encode(xmlStrInjected);
      doc.getZip().file('word/document.xml', outBytes);
      const outBuf = doc.getZip().generate({ type: 'arraybuffer' });
      const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `购销合同_${partyAName}_${partyBName}_${dateStr}.docx`;
      a.click();
      URL.revokeObjectURL(url);

      // 同时将合同信息写入数据库
      await supabase.from('contracts').insert({
        contract_no: contractNo,
        contract_name: `${partyAName}与${partyBName}购销合同`,
        contract_type: '采购合同',
        party_a_name: partyAName,
        party_b_name: partyBName,
        amount: totalRounded,
        signed_at: today.toISOString().slice(0, 10),
        effective_at: genForm.date_start,
        expired_at: genForm.date_end,
        status: '待签署',
        remarks: `由贸易明细自动生成，共 ${rows.length} 笔，原始金额 ¥${totalRaw.toLocaleString('zh-CN')}，取整 ¥${amountNum}（${amountCN}）`,
        created_by: currentUser?.username || null,
      });

      setGenModal(false);
      setTradePreview(null);
      setGenForm({ party_a: '', party_b: '', date_start: '', date_end: '' });
      setPartyASearch('');
      setPartyBSearch('');
      setShowPartyADropdown(false);
      setShowPartyBDropdown(false);
      setPartyASelected(null);
      setPartyBSelected(null);
      fetchContracts();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setGenError('生成失败: ' + msg);
    } finally {
      setGenLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === displayContracts.length && displayContracts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayContracts.map(c => c.id)));
    }
  };

  const fmtAmount = (v?: number | null) =>
    v != null ? `¥ ${v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">合同管理</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            共 <span className="font-bold text-slate-600">{totalCount}</span> 份合同 ·
            总金额 <span className="font-bold text-blue-600">{fmtAmount(totalAmount)}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && canEdit && (
            <button onClick={handleBatchDelete}
              className="px-4 py-2 text-xs font-bold bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 border border-rose-200 transition-colors">
              删除选中 ({selectedIds.size})
            </button>
          )}
          <button onClick={handleExport}
            className="px-4 py-2 text-xs font-bold bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors">
            导出 Excel
          </button>
          <button onClick={() => { setGenModal(true); setGenError(''); setTradePreview(null); setPartyASearch(''); setPartyBSearch(''); setShowPartyADropdown(false); setShowPartyBDropdown(false); setPartyASelected(null); setPartyBSelected(null); }}
            className="px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-1.5">
            🗂️ 生成合同
          </button>
          {canEdit && (
            <button onClick={openNew}
              className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">
              + 新增合同
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { key: 'contract_name', placeholder: '合同名称' },
          { key: 'party_a_name',  placeholder: '甲方' },
          { key: 'party_b_name',  placeholder: '乙方' },
        ].map(f => (
          <input key={f.key}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
            placeholder={f.placeholder}
            value={searchFilters[f.key as keyof typeof searchFilters]}
            onChange={e => setSearchFilters(p => ({ ...p, [f.key]: e.target.value }))}
          />
        ))}
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.status}
          onChange={e => setSearchFilters(p => ({ ...p, status: e.target.value }))}>
          <option value="">全部状态</option>
          {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.contract_type}
          onChange={e => setSearchFilters(p => ({ ...p, contract_type: e.target.value }))}>
          <option value="">全部类型</option>
          {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date"
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.date_start}
          onChange={e => setSearchFilters(p => ({ ...p, date_start: e.target.value }))} />
        <input type="date"
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:bg-white outline-none"
          value={searchFilters.date_end}
          onChange={e => setSearchFilters(p => ({ ...p, date_end: e.target.value }))} />
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {canEdit && (
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox"
                      checked={selectedIds.size === displayContracts.length && displayContracts.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded" />
                  </th>
                )}
                {['合同编号', '合同名称', '类型', '甲方', '乙方', '金额', '签订日期', '到期日期', '状态', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-black text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-12 text-slate-400 font-bold">加载中...</td></tr>
              ) : displayContracts.length === 0 ? (
                <tr><td colSpan={canEdit ? 11 : 10} className="text-center py-16 text-slate-300">
                  <div className="text-4xl mb-2">📄</div>
                  <div className="font-bold">暂无合同数据</div>
                </td></tr>
              ) : displayContracts.map((c, i) => (
                <tr key={c.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded" />
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">{c.contract_no}</td>
                  <td className="px-4 py-3 font-bold text-slate-800 max-w-[180px] truncate" title={c.contract_name}>{c.contract_name}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.contract_type || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[120px] truncate" title={c.party_a_name}>{c.party_a_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[120px] truncate" title={c.party_b_name}>{c.party_b_name || '—'}</td>
                  <td className="px-4 py-3 font-bold text-blue-700 whitespace-nowrap text-right">{fmtAmount(c.amount)}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.signed_at || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.expired_at
                      ? <span className={`${new Date(c.expired_at) < new Date() && c.status === '已签署' ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>{c.expired_at}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg font-bold text-[10px] whitespace-nowrap ${STATUS_COLORS[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)}
                          className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors">编辑</button>
                        <button onClick={() => handleDelete(c.id)}
                          className="px-2 py-1 rounded-lg bg-rose-50 text-rose-500 font-bold hover:bg-rose-100 transition-colors">删除</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>每页</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none">
              {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>条 · 共 {totalCount} 条</span>
          </div>
          <div className="flex gap-1">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">
              上一页
            </button>
            <span className="px-3 py-1 text-xs font-bold text-slate-600">{currentPage} / {totalPages}</span>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base">{editingId ? '编辑合同' : '新增合同'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-8 py-6">
              <div className="grid grid-cols-2 gap-4">
                {/* 合同编号 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同编号 *</label>
                  <input required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.contract_no} onChange={e => setFormData(p => ({ ...p, contract_no: e.target.value }))} />
                </div>
                {/* 合同类型 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同类型</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.contract_type} onChange={e => setFormData(p => ({ ...p, contract_type: e.target.value as ContractType | '' }))}>
                    <option value="">请选择</option>
                    {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* 合同名称 */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同名称 *</label>
                  <input required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.contract_name} onChange={e => setFormData(p => ({ ...p, contract_name: e.target.value }))} />
                </div>
                {/* 甲方 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">甲方名称</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.party_a_name} onChange={e => setFormData(p => ({ ...p, party_a_name: e.target.value }))} />
                </div>
                {/* 乙方 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">乙方名称</label>
                  <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.party_b_name} onChange={e => setFormData(p => ({ ...p, party_b_name: e.target.value }))} />
                </div>
                {/* 金额 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同金额（元）</label>
                  <input type="number" step="0.01" min="0"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                    value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
                </div>
                {/* 状态 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">合同状态</label>
                  <select className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value as ContractStatus }))}>
                    {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* 签订日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">签订日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.signed_at} onChange={e => setFormData(p => ({ ...p, signed_at: e.target.value }))} />
                </div>
                {/* 生效日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">生效日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.effective_at} onChange={e => setFormData(p => ({ ...p, effective_at: e.target.value }))} />
                </div>
                {/* 到期日期 */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">到期日期</label>
                  <input type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={formData.expired_at} onChange={e => setFormData(p => ({ ...p, expired_at: e.target.value }))} />
                </div>
                {/* 备注 */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">备注</label>
                  <textarea rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none resize-none"
                    value={formData.remarks} onChange={e => setFormData(p => ({ ...p, remarks: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                  取消
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 transition-colors disabled:opacity-50">
                  {saving ? '保存中...' : (editingId ? '更新合同' : '创建合同')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── 合同生成弹窗 ── */}
      {genModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => { setShowPartyADropdown(false); setShowPartyBDropdown(false); }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-7 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50">
              <div>
                <h3 className="font-black text-slate-800 text-base">🗂️ 智能合同生成</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">根据贸易明细自动填充合同模板</p>
              </div>
              <button onClick={() => setGenModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <div className="px-7 py-6 space-y-5 overflow-y-auto max-h-[75vh]">

              {/* 甲方（卖方）*/}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  甲方（卖方 / 供应方）<span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                  placeholder="输入关键字搜索甲方..."
                  value={showPartyADropdown ? partyASearch : partyASelectedName}
                  onFocus={async () => {
                    setShowPartyADropdown(true);
                    setPartyASearch(partyASelectedName);
                    const results = await searchPartyOptions(partyASelectedName);
                    setFilteredPartyA(results);
                  }}
                  onChange={async e => {
                    const val = e.target.value;
                    setPartyASearch(val);
                    setShowPartyADropdown(true);
                    setGenForm(p => ({ ...p, party_a: '' }));
                    setTradePreview(null);
                    const results = await searchPartyOptions(val);
                    setFilteredPartyA(results);
                  }}
                />
                {showPartyADropdown && filteredPartyA.length > 0 && (
                  <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredPartyA.map(o => (
                      <li key={o.id}
                        className="px-4 py-2.5 text-sm cursor-pointer hover:bg-emerald-50 text-slate-700 flex items-center justify-between"
                        onMouseDown={() => {
                          setGenForm(p => ({ ...p, party_a: o.id }));
                          setPartyASelected(o);
                          setPartyASearch(o.name);
                          setShowPartyADropdown(false);
                          setTradePreview(null);
                        }}>
                        <span>{o.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ml-2 shrink-0 ${o.source === 'org' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                          {o.source === 'org' ? '集团' : '客户'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 乙方（买方）*/}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  乙方（买方 / 购买方）<span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                  placeholder="输入关键字搜索乙方..."
                  value={showPartyBDropdown ? partyBSearch : partyBSelectedName}
                  onFocus={async () => {
                    setShowPartyBDropdown(true);
                    setPartyBSearch(partyBSelectedName);
                    const results = await searchPartyOptions(partyBSelectedName);
                    setFilteredPartyB(results);
                  }}
                  onChange={async e => {
                    const val = e.target.value;
                    setPartyBSearch(val);
                    setShowPartyBDropdown(true);
                    setGenForm(p => ({ ...p, party_b: '' }));
                    setTradePreview(null);
                    const results = await searchPartyOptions(val);
                    setFilteredPartyB(results);
                  }}
                />
                {showPartyBDropdown && filteredPartyB.length > 0 && (
                  <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredPartyB.map(o => (
                      <li key={o.id}
                        className="px-4 py-2.5 text-sm cursor-pointer hover:bg-emerald-50 text-slate-700 flex items-center justify-between"
                        onMouseDown={() => {
                          setGenForm(p => ({ ...p, party_b: o.id }));
                          setPartyBSelected(o);
                          setPartyBSearch(o.name);
                          setShowPartyBDropdown(false);
                          setTradePreview(null);
                        }}>
                        <span>{o.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ml-2 shrink-0 ${o.source === 'org' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                          {o.source === 'org' ? '集团' : '客户'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 贸易时间段 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    开始日期 <span className="text-rose-400">*</span>
                  </label>
                  <input type="date"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={genForm.date_start}
                    onChange={e => { setGenForm(p => ({ ...p, date_start: e.target.value })); setTradePreview(null); }} />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    结束日期 <span className="text-rose-400">*</span>
                  </label>
                  <input type="date"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white outline-none"
                    value={genForm.date_end}
                    onChange={e => { setGenForm(p => ({ ...p, date_end: e.target.value })); setTradePreview(null); }} />
                </div>
              </div>

              {/* 查询贸易明细按钮 */}
              <button
                type="button"
                disabled={!genForm.party_a || !genForm.party_b || !genForm.date_start || !genForm.date_end || previewLoading}
                onClick={handlePreviewTrade}
                className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                {previewLoading ? '查询中...' : '🔍 查询贸易明细'}
              </button>

              {/* 贸易数据预览 */}
              {tradePreview && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-emerald-600 font-black text-sm">📊 贸易汇总预览</span>
                    <span className="text-[10px] text-emerald-500 bg-emerald-100 px-2 py-0.5 rounded-full">{tradePreview.dateRange}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded-xl p-3">
                      <div className="text-slate-400 text-[10px] mb-1">贸易笔数</div>
                      <div className="font-black text-slate-800 text-lg">{tradePreview.count} 笔</div>
                    </div>
                    <div className="bg-white rounded-xl p-3">
                      <div className="text-slate-400 text-[10px] mb-1">原始合计金额</div>
                      <div className="font-black text-slate-700">¥ {tradePreview.totalRaw.toLocaleString('zh-CN')}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-slate-400 text-[10px] mb-1">合同金额（取整千元）</div>
                    <div className="font-black text-emerald-700 text-xl">¥ {tradePreview.totalRounded.toLocaleString('zh-CN')}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{toChinaAmount(tradePreview.totalRounded)}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 text-xs text-slate-500 space-y-1">
                    <div><span className="font-bold text-slate-700">数量：</span>一批</div>
                    <div><span className="font-bold text-slate-700">单价：</span>时价</div>
                  </div>
                  {tradePreview.count === 0 && (
                    <div className="text-amber-600 text-xs font-bold bg-amber-50 rounded-xl p-3">
                      ⚠️ 该时间段内未查到贸易记录，合同金额将为 ¥0，请确认后继续。
                    </div>
                  )}
                </div>
              )}

              {/* 错误提示 */}
              {genError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-600 font-bold">
                  ⚠️ {genError}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setGenModal(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                  取消
                </button>
                <button
                  type="button"
                  disabled={!tradePreview || genLoading}
                  onClick={handleGenerateContract}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                  {genLoading ? '生成中...' : '📄 生成并下载合同'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
