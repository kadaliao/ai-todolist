/** Deep copy of JSON data; `structuredClone` where available (Hermes may lack it). */
export function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}
