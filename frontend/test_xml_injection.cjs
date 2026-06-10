/**
 * test_xml_injection.cjs
 * 验证 docx 商品明细多列注入逻辑（含 UTF-8 编码正确处理）
 *
 * 运行：cd frontend && node test_xml_injection.cjs
 * 输出：public/test_contract_multi_col.docx
 */

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');

// ── XML 字符转义 ────────────────────────────────────────────────
function xmlText(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 在数据行 XML 中注入商品文本到每个单元格 ─────────────────────
// 注意：rowXml 是 UTF-8 字符串（已解码），含完整 <w:tr...>...</w:tr>
function injectTextToRowCells(rowXml, invoice) {
  const vals = [
    xmlText(invoice.product_info || '（未填写）'),
    '公斤',
    invoice.quantity != null ? String(invoice.quantity) : '—',
    invoice.unit_price != null ? '\u00A5' + invoice.unit_price.toFixed(2) : '时价',
    invoice.amount != null
      ? '\u00A5' + invoice.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
      : '—',
  ];

  // 找到 <w:tr...> 结束 > 的位置
  const trTagEnd = rowXml.indexOf('>');
  const trOpenTag = rowXml.substring(0, trTagEnd + 1);
  const innerXml = rowXml.substring(trTagEnd + 1, rowXml.length - 7); // 去掉 <w:tr...> 和 </w:tr>

  // 1. 替换 Cell 0 的 undefined 占位符
  let result = innerXml.replace(
    '<w:t xml:space="preserve">undefined</w:t>',
    '<w:t xml:space="preserve">' + vals[0] + '</w:t>'
  );

  // 2. 按顺序替换 Cell 1-4 末尾的空 run
  let valIdx = 1;
  result = result.replace(/<w:r\/><\/w:p><\/w:tc>/g, () => {
    const text = valIdx < vals.length ? vals[valIdx++] : '';
    return '<w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
  });

  return trOpenTag + result + '</w:tr>';
}

// ── 主函数：注入商品明细到 document.xml (UTF-8 字符串) ──────────
function injectInvoiceRowsIntoDocXml(xmlStr, invoiceRows) {
  const tblStart = xmlStr.indexOf('<w:tbl>');
  if (tblStart === -1) { console.warn('No table found'); return xmlStr; }
  const tblEnd = xmlStr.indexOf('</w:tbl>') + 8;
  const tbl = xmlStr.substring(tblStart, tblEnd);

  // 定位第2行（rowIdx=1 = 数据行）
  let rp = 0, rowIdx = 0;
  let dataRowStart = -1, dataRowEnd = -1;
  while ((rp = tbl.indexOf('<w:tr', rp)) !== -1) {
    const re = tbl.indexOf('</w:tr>', rp) + 7;
    if (rowIdx === 1) { dataRowStart = rp; dataRowEnd = re; break; }
    rowIdx++;
    rp = re + 7;
  }
  if (dataRowStart === -1) { console.warn('Data row not found'); return xmlStr; }

  const dataRowXml = tbl.substring(dataRowStart, dataRowEnd);
  const newRows = invoiceRows.map(inv => injectTextToRowCells(dataRowXml, inv));

  const absStart = tblStart + dataRowStart;
  const absEnd = tblStart + dataRowEnd;
  return xmlStr.substring(0, absStart) + newRows.join('') + xmlStr.substring(absEnd);
}

// ═══════════════════════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════════════════════
const buf = fs.readFileSync('public/contract_template.docx');
const zip = new PizZip(buf);
const doc = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: { start: '{{', end: '}}' },
});
doc.render({
  '合同编号': 'HLS-20260519-1234',
  '甲方': '广东海露农业发展有限公司',
  '乙方': '广州百钰得电子商务有限公司',
  '开始日期': '2025-01-01',
  '结束日期': '2025-12-31',
  '签署日期': '2026年5月19日',
});

// ★ 关键：asBinary() 返回 Latin-1 字节串，转 UTF-8 字符串才能正确处理中文
const xmlBin = doc.getZip().files['word/document.xml'].asBinary();
const xmlBytes = Buffer.from(xmlBin, 'binary');
let xmlStr = xmlBytes.toString('utf8');

const mockInvoices = [
  { product_info: '羊肉串', quantity: 500, unit_price: 28.50, amount: 14250.00 },
  { product_info: '羊肉卷', quantity: 300, unit_price: 32.00, amount: 9600.00 },
  { product_info: '羊蝎子', quantity: 200, unit_price: 25.00, amount: 5000.00 },
];

xmlStr = injectInvoiceRowsIntoDocXml(xmlStr, mockInvoices);

// ★ 关键：UTF-8 字符串 → binary string 写回 zip
const xmlBinNew = Buffer.from(xmlStr, 'utf8').toString('binary');

const newZip = new PizZip();
Object.entries(doc.getZip().files).forEach(([name, file]) => {
  if (name === 'word/document.xml') newZip.file(name, xmlBinNew);
  else newZip.file(name, file.asBinary());
});

const outBuf = newZip.generate({ type: 'nodebuffer' });
fs.writeFileSync('public/test_contract_multi_col.docx', outBuf);
console.log('OK，大小:', outBuf.length, '字节');

// ── 验证输出 ──
const verifyZip = new PizZip(outBuf);
const verifyBin = verifyZip.files['word/document.xml'].asBinary();
const verifyXml = Buffer.from(verifyBin, 'binary').toString('utf8');
const tbl2Start = verifyXml.indexOf('<w:tbl>');
const tbl2 = verifyXml.substring(tbl2Start, verifyXml.indexOf('</w:tbl>') + 8);
const rows = [];
let rpos = 0;
while ((rpos = tbl2.indexOf('<w:tr', rpos)) !== -1) {
  const re = tbl2.indexOf('</w:tr>', rpos) + 7;
  rows.push(tbl2.substring(rpos, re));
  rpos = re;
}
console.log('表格行数:', rows.length, '(期望 5: 表头+3数据+合计)');
rows.forEach((r, i) => {
  const texts = [];
  let tp = 0;
  while ((tp = r.indexOf('<w:t>', tp)) !== -1) {
    const te = r.indexOf('</w:t>', tp);
    const t = r.substring(tp + 5, te);
    if (t.trim() && t.trim() !== 'undefined') texts.push(t.trim());
    tp = te + 6;
  }
  // 也捕获 <w:t xml:space="preserve">...</w:t>
  let tp2 = 0;
  const re2 = /<w:t [^>]+>([^<]+)<\/w:t>/g;
  let m;
  while ((m = re2.exec(r)) !== null) {
    if (m[1].trim()) texts.push(m[1].trim());
  }
  console.log('  Row', i, ':', texts.join(' | '));
});
