/** 自選匯入：支援貼上文字、代號清單、CSV（可含群組欄）。 */

export interface ImportResult {
  codes: { code: string; group?: string }[];
  unknown: string[];
}

const CODE_RE = /^(?:\d{4}[A-Z]?|00[0-9A-Z]{2,4})$/;
const HEADER_CODE = ['代號', '股票代號', '證券代號', 'code', 'symbol', 'ticker'];
const HEADER_GROUP = ['群組', '分組', 'group', 'category'];

function splitLine(line: string): string[] {
  return line.split(/[,\t;，、|]+|\s+/).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

export function parseImport(text: string, known: Set<string>, byName: Map<string, string>): ImportResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = new Map<string, string | undefined>();
  const unknown: string[] = [];
  let codeCol = -1;
  let groupCol = -1;
  lines.forEach((line, idx) => {
    const cells = line.split(/[,\t;]/).map((s) => s.trim().replace(/^"|"$/g, ''));
    if (idx === 0) {
      const lower = cells.map((c) => c.toLowerCase());
      codeCol = lower.findIndex((c) => HEADER_CODE.includes(c));
      groupCol = lower.findIndex((c) => HEADER_GROUP.includes(c));
      if (codeCol >= 0) return; // 標題列
    }
    if (codeCol >= 0) {
      const code = (cells[codeCol] ?? '').toUpperCase().replace(/\.TWO?$/, '');
      const group = groupCol >= 0 ? cells[groupCol] || undefined : undefined;
      if (known.has(code)) out.set(code, group);
      else if (code) unknown.push(code);
      return;
    }
    for (const token of splitLine(line)) {
      const t = token.toUpperCase().replace(/\.TWO?$/, '');
      if (CODE_RE.test(t)) {
        if (known.has(t)) out.set(t, out.get(t));
        else unknown.push(t);
      } else if (byName.has(token)) {
        const code = byName.get(token)!;
        if (!out.has(code)) out.set(code, undefined);
      } else if (!/^\d+(\.\d+)?$/.test(token)) {
        // 名稱緊跟在代號後面（例如「2330 台積電」）時忽略名稱
        const prev = [...out.keys()].pop();
        if (!prev) unknown.push(token);
      }
    }
  });
  return { codes: [...out.entries()].map(([code, group]) => ({ code, group })), unknown: [...new Set(unknown)] };
}
