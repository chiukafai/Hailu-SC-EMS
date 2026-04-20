const XLSX = require('xlsx');
try {
    const workbook = XLSX.readFile('发票明细表模板.xlsx');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, {header: 1});
    console.log("HEADERS FOUND:");
    console.log(JSON.stringify(data[0]));
    console.log("FIRST ROW:");
    console.log(JSON.stringify(data[1]));
} catch(e) {
    console.error(e);
}
