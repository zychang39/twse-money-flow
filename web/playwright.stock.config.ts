// 暫時檔（stock 代理本機跑 e2e 用，跑完刪除）：以 4312 埠的示範資料 build 執行
import base from './playwright.config';
export default { ...base, use: { ...base.use, baseURL: 'http://localhost:4312/twse-money-flow/' }, webServer: undefined, projects: [base.projects![0]] };
