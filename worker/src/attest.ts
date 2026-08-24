/**
 * Client attestation.
 *
 * READ THIS BEFORE PUTTING ANYTHING BEHIND IT: this is NOT authentication.
 * The signing key ships inside a desktop binary on hardware the attacker
 * owns, so it is extractable by anyone willing to open a disassembler. What
 * it actually buys is (a) blocking drive-by curl/bot traffic, which is 99% of
 * real abuse, (b) a cheap filter that runs before we touch D1, and (c) a
 * credential that is REVOCABLE PER APP VERSION.
 *
 * (c) is the reason for the derivation below. The binary carries only
 * K_ver = HKDF(MASTER, info="app:<semver>"). If 1.4.3's key leaks, dropping
 * 1.4.3 from ACCEPTED_VERSIONS kills every forged request signed with it
 * without touching any other release and without rebuilding anything.
 */
import { CLOCK_SKEW_S, MAX_BODY_BYTES, hex, isVersion, nowS, sha256Hex, timingSafeEqual } from "./util";
import type { Env } from "./env";

export const HKDF_SALT = "isle-attest-v1";

const keyCache = new Map<string, CryptoKey>();

async function versionKey(master: string, version: string): Promise<CryptoKey> {
  const cached = keyCache.get(version);
  if (cached) return cached;

  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey("raw", hexToBytes(master), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(HKDF_SALT), info: enc.encode(`app:${version}`) },
    ikm,
    256,
  );
  const key = await crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  keyCache.set(version, key);
  return key;
}

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/**
 * Canonical string. Both sides must build it identically; see
 * `src-tauri/src/telemetry/attest.rs`, which has a test pinning this format.
 */
export const canonical = (ts: number, path: string, bodyHash: string) =>
  `${ts}\n${path}\n${bodyHash}`;

export type Attested =
  | { ok: true; version: string; body: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

export async function verify(req: Request, env: Env, path: string): Promise<Attested> {
  const version = req.headers.get("x-ov-ver") ?? "";
  const tsRaw = req.headers.get("x-ov-ts") ?? "";
  const sig = req.headers.get("x-ov-sig") ?? "";
  if (!isVersion(version) || !/^\d{1,12}$/.test(tsRaw) || !/^[0-9a-f]{64}$/.test(sig)) {
    return { ok: false, status: 401, reason: "malformed" };
  }

  // Server clock only. Client clocks on Windows drift by hours (dual-boot
  // machines fight over RTC-vs-UTC), so a client timestamp is evidence of
  // freshness and nothing else.
  const ts = Number(tsRaw);
  if (Math.abs(nowS() - ts) > CLOCK_SKEW_S) {
    return { ok: false, status: 401, reason: "skew" };
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "too_large" };
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "too_large" };

  const key = await versionKey(env.ATTEST_MASTER, version);
  const want = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(canonical(ts, path, await sha256Hex(raw))),
    ),
  );
  if (!timingSafeEqual(sig, want)) return { ok: false, status: 401, reason: "signature" };

  try {
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, status: 400, reason: "body" };
    }
    return { ok: true, version, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, reason: "body" };
  }
}
