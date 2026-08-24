export const MAX_BODY_BYTES = 16 * 1024;
export const CLOCK_SKEW_S = 300;

export const utcDay = (ts: number) => Math.floor(ts / 86400);
export const nowS = () => Math.floor(Date.now() / 1000);

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

/** Constant-time string compare. `!==` on a signature leaks it one byte at a time. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Rejects the nil UUID too: it is what a broken client sends, and one bad
 *  build would otherwise collapse thousands of installs into one row. */
export const isClientId = (v: unknown): v is string =>
  typeof v === "string" && UUID_V4.test(v) && v.toLowerCase() !== NIL_UUID;

/**
 * Case-fold an install id before it is used as a key.
 *
 * The regex accepts either case, and our own client only ever sends
 * lowercase — but a fork sending uppercase would mint a SECOND row for a
 * device that already exists, which shows up as inflated install counts and
 * nothing else. Normalising at the boundary makes that impossible.
 */
export const clientIdKey = (v: string): string => v.toLowerCase();

const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export const isVersion = (v: unknown): v is string =>
  typeof v === "string" && SEMVER.test(v);

/** Every string that reaches storage goes through this. A client-side cap is
 *  a suggestion; this is the rule. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function num(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}
