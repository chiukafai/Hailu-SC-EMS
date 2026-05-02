import * as XLSX from 'xlsx';

// 组织架构模板
const orgHeaders = [
    '实体全称', '机构简称', '信用代码', '财务负责人', '成立时间',
    '法人代表', '法人电话', '股东及持股比例', '注册资本',
    '省份', '城市', '详细注册地址',
    '开户银行', '银行账号', '发票额度', '信用评级', '纳税人类型'
];
const orgData = [
    orgHeaders,
    ['示例集团有限公司', '示例集团', '914400000000000001', '张三', '2020-01-01', '李四', '13800138000', '张三50%, 李四50%', '1000', '广东', '广州', '越秀区某某路1号', '中国工商银行', '6222020000000000001', '1000', 'A', '一般纳税人'] // Example values
];

const orgWs = XLSX.utils.aoa_to_sheet(orgData);
const orgWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(orgWb, orgWs, "组织架构");
XLSX.writeFile(orgWb, "组织架构导入模板.xlsx");

// 客户主档模板
const clientHeaders = [
    '归属部门', '企业法定全称', '客户简称', '纳税人识别号', '成立时间',
    '法人姓名', '联系电话', '股东信息', '注册资本', 
    '省份', '城市', '详细注册地址',
    '开户银行', '银行账号', '月度开票限额', '信用评级', '纳税人类型', '风控状态', '添加日期'
];
const clientData = [
    clientHeaders,
    ['华南业务部', '示例客户科技有限公司', '客户科技', '914400000000000002', '2019-05-20', '王五', '13900139000', '王五100%', '500', '广东', '深圳', '南山区科技园2号', '招商银行', '6222020000000000002', '500', 'A', '一般纳税人', '低风险', '2023-10-01'] // Example values
];

const clientWs = XLSX.utils.aoa_to_sheet(clientData);
const clientWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(clientWb, clientWs, "客户主档");
XLSX.writeFile(clientWb, "客户主档导入模板.xlsx");

// 业务贸易数据模板
const invoiceHeaders = [
    '所属项目', '主体公司', '商品信息', '数量', '单价', '金额', '往来客户', '是否开票', '已走流水', '发生日期', '地点', '备注'
];
const invoiceData = [
    invoiceHeaders,
    ['光伏出口一期', '海外拓展部', '太阳能板组件', 1500, 200, 300000, 'Tech Corp', '否', '否', '2023-10-01', '上海浦东', '出口退税待确认'],
    ['设备采购', '华南分公司', '工业级逆变器', 20, 50000, 1000000, 'Global Supply', '是', '是', '2023-11-15', '广州南沙', '加急发货流水已走']
];

const invoiceWs = XLSX.utils.aoa_to_sheet(invoiceData);
const invoiceWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(invoiceWb, invoiceWs, "业务贸易数据");
XLSX.writeFile(invoiceWb, "业务贸易数据导入模板.xlsx");

console.log('Templates generated successfully.');
