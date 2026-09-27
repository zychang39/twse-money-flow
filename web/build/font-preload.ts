/** Vite 外掛：build 時在 index.html 預載自託管的 Inter（避免字型替換造成版面位移）。 */
import type { Plugin } from 'vite';

export function fontPreload(): Plugin {
  return {
    name: 'font-preload',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const font = Object.keys(ctx.bundle ?? {}).find((f) => /inter-latin-wght-normal.*\.woff2$/.test(f));
      if (!font) return html;
      return {
        html,
        tags: [{ tag: 'link', attrs: { rel: 'preload', href: `./${font}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }],
      };
    },
  };
}
