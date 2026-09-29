// 截圖用的中文字型：雲端截圖環境只有文泉驛正黑，它的「佔」字形幾乎和「估」一樣（iPhone 的蘋方沒有這個問題），
// 截圖會誤導。設定 CJK_FONT_DIR 指向 @fontsource/noto-sans-tc 的安裝目錄時，以路由＋@font-face 注入 Noto Sans TC
// （App 的字體堆疊本來就有 'Noto Sans TC'）。只影響截圖，不會打包進網站。
// 例：npm i --prefix /tmp/cjk @fontsource/noto-sans-tc@5.3.0 && CJK_FONT_DIR=/tmp/cjk/node_modules/@fontsource/noto-sans-tc node scripts/ux-shots.mjs …
import { readFileSync } from 'node:fs';

export async function useCjkFont(context, dir = process.env.CJK_FONT_DIR) {
  if (!dir) return false;
  const base = ['400', '500', '600'].map((w) => readFileSync(`${dir}/${w}.css`, 'utf8')).join('\n').replaceAll('url(./files/', 'url(/__cjk/');
  // M3：App 的字體堆疊是 -apple-system, …, 'PingFang TC'；截圖環境沒有蘋方，以同一份 Noto Sans TC 冒名 PingFang TC（只影響截圖）
  const css = `${base}\n${base.replaceAll(/font-family: ?'Noto Sans TC'/g, "font-family: 'PingFang TC'")}`;
  await context.route('**/__cjk/**', (route) => route.fulfill({ path: `${dir}/files/${route.request().url().split('/__cjk/')[1]}` }));
  await context.addInitScript((text) => {
    const add = () => { const s = document.createElement('style'); s.textContent = text; document.head.appendChild(s); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
    else add();
  }, css);
  return true;
}
