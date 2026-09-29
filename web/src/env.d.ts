/// <reference types="vite/client" />
declare module '*.yml' {
  const data: unknown;
  export default data;
}
/** build 時由 vite.config.ts 的 define 注入（見 lib/swUpdate.ts appVersion）。 */
declare const __APP_COMMIT__: string;
declare const __APP_BUILD_DATE__: string;
