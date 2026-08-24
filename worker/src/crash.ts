import { verify } from "./attest";
import { clientIdKey, isClientId, nowS, str, utcDay } from "./util";
import type { Env } from "./env";

/**
 * Crash reports, AGGREGATED.
 *
 * One row per (fingerprint, version, day) — never one row per crash. A single
 * machine stuck in a one-second crash-retry loop produces 86,400 reports a
 * day, which would exhaust the entire D1 write budget before lunch. The
 * client caps itself too (3 per process, 10 per day); this is the backstop
 * that holds when a forked or old build ignores that.
 */
export async function handleCrash(req: Request, env: Env): Promise<Response> {
  const att = await verify(req, env, "/v1/crash");
  if (!att.ok) return new Response(null, { status: att.status });

  const b = att.body;
  if (!isClientId(b.client_id)) return new Response(null, { status: 400 });
  const clientId = clientIdKey(b.client_id);

  const { success } = await env.RL_WRITE.limit({ key: clientId });
  if (!success) return new Response(null, { status: 429 });

  const fingerprint = str(b.fingerprint, 64);
  const message = str(b.message, 512);
  if (!fingerprint || !/^[0-9a-f]{16,64}$/.test(fingerprint) || !message) {
    return new Response(null, { status: 400 });
  }
  // Already scrubbed of C:\Users\<name>\ on the Rust side, before it ever
  // left the machine. Truncated again here because a client-side cap is a
  // suggestion.
  const stack = str(b.stack, 4096);

  const ts = nowS();
  env.AE.writeDataPoint({
    indexes: ["crash"],
    blobs: [clientId, att.version, fingerprint, message, env.BUILD_ENV],
    doubles: [1],
  });

  try {
    await env.DB.prepare(
      `INSERT INTO crash_agg
         (fingerprint, app_version, utc_day, occurrences, first_ts, last_ts, sample_msg, sample_stack)
       VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5, ?6)
       ON CONFLICT (fingerprint, app_version, utc_day) DO UPDATE SET
         occurrences  = crash_agg.occurrences + 1,
         last_ts      = excluded.last_ts,
         -- Keep the first sample we got, but fill in a stack later if the
         -- first report arrived without one. Otherwise a stackless first
         -- crash permanently blinds the whole day's aggregate.
         sample_stack = COALESCE(crash_agg.sample_stack, excluded.sample_stack)`,
    )
      .bind(fingerprint, att.version, utcDay(ts), ts, message, stack)
      .run();
  } catch (e) {
    console.error("crash: d1 upsert failed", e);
  }

  return new Response(null, { status: 204 });
}
