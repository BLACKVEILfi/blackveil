// Tiny per-IP token bucket for the API: 120 requests a minute.
const RATE = 120, WINDOW = 60_000;
const buckets = new Map();
export function hit(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.t > WINDOW) { b = { t: now, n: 0 }; buckets.set(ip, b); }
  b.n++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.t > WINDOW) buckets.delete(k);
  return b.n <= RATE;
}
