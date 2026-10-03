import base from './playwright.config';
export default { ...base, testDir: '/home/user/twse-money-flow/web/e2e', use: { ...base.use, baseURL: 'http://localhost:4303/twse-money-flow/' }, webServer: undefined, workers: 2,
  projects: [base.projects![0]] };
