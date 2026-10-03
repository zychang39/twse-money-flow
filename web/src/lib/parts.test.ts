import { describe, expect, it } from 'vitest';
import { assembleParts } from './parts';

describe('分檔資料', () => {
  it('沒有 parts 時原樣回傳', async () => {
    expect(await assembleParts('a.json', { x: 1 }, async () => null)).toEqual({ x: 1 });
    expect(await assembleParts('a.json', [1, 2], async () => null)).toEqual([1, 2]);
  });
  it('依序接起指定的陣列', async () => {
    const files: Record<string, unknown> = { 'p-0.json': { rows: [1, 2], open: [[1]] }, 'p-1.json': { rows: [3], open: [[2]] } };
    const r = await assembleParts<{ rows: number[]; open: number[][]; dates: string[] }>('p.json', { parts: 2, part_keys: ['rows', 'open'], dates: ['d'] }, async (p) => files[p]);
    expect(r).toEqual({ rows: [1, 2, 3], open: [[1], [2]], dates: ['d'] });
  });
  it('整個檔案是陣列（鍵 _）', async () => {
    const files: Record<string, unknown> = { 'f-0.json': { _: [[1]] }, 'f-1.json': { _: [[2]] } };
    expect(await assembleParts('f.json', { parts: 2, part_keys: ['_'] }, async (p) => files[p])).toEqual([[1], [2]]);
  });
});
