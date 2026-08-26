export function genLid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function getQ(it: { q?: number }) { return it.q ?? 0; }
export function getQs(it: { qs?: number }) { return it.qs ?? 0; }
export function getMin(it: { min?: number }) { return it.min ?? 5; }
export function firstNum(s: string) {
  const m = String(s).match(/\d+([.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : 0;
}
