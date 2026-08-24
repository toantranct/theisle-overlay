/**
 * Dev helper: sign and send a request the way the Rust client does.
 *
 * Exists so the canonical string and the HKDF derivation can be checked from
 * the command line without building the app. If this script and
 * `src-tauri/src/telemetry/attest.rs` ever disagree, one of them is the bug.
 *
 *   node scripts/sign.mjs /v1/ping '{"client_id":"...","launches":1}'
 *   node scripts/sign.mjs --skew /v1/ping '{...}'   # timestamp 10 min old
 *   node scripts/sign.mjs --bad  /v1/ping '{...}'   # corrupt signature
 */
import { createHash, hkdfSync, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const HKDF_SALT = "isle-attest-v1";
const VERSION = process.env.OV_VERSION ?? "1.4.3";
const BASE = process.env.OV_BASE ?? "http://127.0.0.1:8787";

const master = (process.env.ATTEST_MASTER ??
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split("\n")
    .find((l) => l.startsWith("ATTEST_MASTER="))
    .slice("ATTEST_MASTER=".length)).trim();

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
let [path, bodyArg = "{}"] = args.filter((a) => !a.startsWith("--"));
// `@file.json` reads the body from disk. Worth having: a JSON payload with
// backslashes in it (any Windows stack trace) does not survive a round trip
// through the shell intact.
const body = bodyArg.startsWith("@") ? readFileSync(bodyArg.slice(1), "utf8").trim() : bodyArg;

const kVer = Buffer.from(
  hkdfSync("sha256", Buffer.from(master, "hex"), Buffer.from(HKDF_SALT), Buffer.from(`app:${VERSION}`), 32),
);

const ts = Math.floor(Date.now() / 1000) - (flags.has("--skew") ? 600 : 0);
const bodyHash = createHash("sha256").update(body).digest("hex");
let sig = createHmac("sha256", kVer).update(`${ts}\n${path}\n${bodyHash}`).digest("hex");
if (flags.has("--bad")) sig = sig.replace(/^./, (c) => (c === "a" ? "b" : "a"));

const res = await fetch(BASE + path, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-ov-ver": VERSION,
    "x-ov-ts": String(ts),
    "x-ov-sig": sig,
  },
  body,
});
console.log(res.status, (await res.text()) || "(empty)");
