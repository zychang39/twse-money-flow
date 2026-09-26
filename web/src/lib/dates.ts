/** 台北時間的今天（YYYY-MM-DD）。 */
export function todayTpe(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** isoDate 之後到今天（台北）為止的工作日數（週一～週五；不含國定假日，用於「資料可能過期」的粗略判斷）。 */
export function businessDaysSince(isoDate: string, now: Date): number {
  const today = todayTpe(now);
  const d = new Date(`${isoDate}T12:00:00Z`);
  let count = 0;
  for (let i = 0; i < 400; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const s = d.toISOString().slice(0, 10);
    if (s > today) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
