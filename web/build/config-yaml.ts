/**
 * Vite 外掛：讓前端直接 import ../config/*.yml（pipeline 與 web 共用的單一事實來源）。
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { Plugin } from 'vite';

export function configYaml(): Plugin {
  return {
    name: 'config-yaml',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return null;
      const data: unknown = parse(readFileSync(file, 'utf8'));
      return { code: `export default ${JSON.stringify(data)};`, map: null };
    },
  };
}
