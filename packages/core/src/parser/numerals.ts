const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Arabic digits or Chinese numerals 1–99 ("十五", "二十", "两"). */
export const NUM = '(?:\\d{1,3}|[零〇一二两三四五六七八九十]{1,3})';

export function parseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (!s || !/^[零〇一二两三四五六七八九十]+$/.test(s)) return null;
  const ten = s.indexOf('十');
  if (ten === -1) {
    if (s.length !== 1) return null;
    return DIGITS[s] ?? null;
  }
  if (s.indexOf('十', ten + 1) !== -1) return null;
  const tens = ten === 0 ? 1 : DIGITS[s.slice(0, ten)];
  const ones = ten === s.length - 1 ? 0 : DIGITS[s.slice(ten + 1)];
  if (tens === undefined || ones === undefined || s.slice(0, ten).length > 1 || s.slice(ten + 1).length > 1) {
    return null;
  }
  return tens * 10 + ones;
}
