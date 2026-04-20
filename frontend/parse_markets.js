const XLSX = require('xlsx');
const fs = require('fs');
const workbook = XLSX.readFile('全国主要城市农产品批发市场名录.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
fs.writeFileSync('/tmp/markets_structure.json', JSON.stringify(data.slice(0, 5), null, 2));
