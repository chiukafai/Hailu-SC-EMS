const PizZip = require('pizzip');
const fs = require('fs');

const buf = fs.readFileSync('public/contract_template.docx');
const zip = new PizZip(buf);
const xml = zip.files['word/document.xml'].asText();

// 找表格
const tblStart = xml.indexOf('<w:tbl');
const tblEnd = xml.indexOf('</w:tbl>') + 8;
const tblXml = xml.substring(tblStart, tblEnd);

// 找所有 <w:tr
const rows = [];
let pos = 0;
while ((pos = tblXml.indexOf('<w:tr', pos)) !== -1) {
  const end = tblXml.indexOf('</w:tr>', pos) + 8;
  rows.push(tblXml.substring(pos, end));
  pos = end;
}

// 找 placeholder 行
const phIdx = rows.findIndex(r => r.includes('{{商品明细}}'));
let cleanRow = rows[phIdx].replace('<w:t>{{商品明细}}</w:t>', '<w:t></w:t>');

// 找所有 <w:t>...</w:t> 位置
const textPositions = [];
let tp = 0;
while ((tp = cleanRow.indexOf('<w:t>', tp)) !== -1) {
  const te = cleanRow.indexOf('</w:t>', tp);
  textPositions.push({ start: tp, end: te + 6 });
  tp = te + 6;
}
console.log('Text positions count:', textPositions.length);
textPositions.forEach((p, i) => {
  console.log('  Pos', i, ':', JSON.stringify(cleanRow.substring(p.start, p.end)));
});

// 找 5 个单元格的段落起始位置（<w:p w14:paraId）
const paraPositions = [];
let pp = 0;
while ((pp = cleanRow.indexOf('<w:p w14:paraId', pp)) !== -1) {
  // 找这个 <w:p 的结束 </w:p>
  const pe = cleanRow.indexOf('</w:p>', pp);
  paraPositions.push({ start: pp, end: pe + 6 });
  pp = pe + 6;
}
console.log('Paragraph count:', paraPositions.length);
