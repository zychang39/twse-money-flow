/**
 * 分檔資料（F 節：單一資料檔壓縮後 ≤ 300KB；pipeline export.write_json_split）：主檔有 parts＝k 時，
 * 依序讀 {stem}-0.json … {stem}-(k−1).json，把 part_keys 指定的陣列接起來；鍵為「_」表示整個檔案原本就是一個陣列。
 */
export interface PartsBase { parts?: number; part_keys?: string[]; [key: string]: unknown }

export async function assembleParts<T>(path: string, base: unknown, get: (path: string) => Promise<unknown>): Promise<T> {
  if (!base || Array.isArray(base) || typeof base !== 'object' || !(base as PartsBase).parts) return base as T;
  const b = base as PartsBase;
  const stem = path.replace(/\.json$/, '');
  const k = Number(b.parts);
  const parts = (await Promise.all(Array.from({ length: k }, (_, i) => get(`${stem}-${i}.json`)))) as Record<string, unknown[]>[];
  const keys = b.part_keys ?? [];
  const out: Record<string, unknown> = { ...b };
  delete out.parts;
  delete out.part_keys;
  for (const key of keys) out[key] = parts.flatMap((p) => p[key] ?? []);
  return (keys.length === 1 && keys[0] === '_' ? out._ : out) as T;
}
