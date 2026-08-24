import { verify } from "./attest";
import { DOUBLE_FEATURE_BASE, FEATURE_SLOTS } from "./features";
import { clientIdKey, isClientId, nowS, num, str, utcDay } from "./util";
import type { Env } from "./env";

export async function handlePing(req: Request, env: Env): Promise<Response> {
  const att = await verify(req, env, "/v1/ping");
  if (!att.ok) return new Response(null, { status: att.status });

  const b = att.body;
  if (!isClientId(b.client_id)) return new Response(null, { status: 400 });
  const clientId = clientIdKey(b.client_id);

  const { success } = await env.RL_PING.limit({ key: clientId });
  if (!success) return new Response(null, { status: 429 });

  const ts = nowS();
  const day = utcDay(ts);
  // cf.country, never the IP. Geo accuracy is better than any IP lookup we
  // could do, and the raw address never enters the system at all.
  const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? null;

  const launches = num(b.launches, 1, 1000);
  const sessionMinutes = num(b.session_minutes, 0, 24 * 60);
  const osBuild = str(b.os_build, 32);
  const locale = str(b.locale, 16);

  const features = Array.isArray(b.features) ? (b.features as unknown[]) : [];
  const doubles = new Array<number>(DOUBLE_FEATURE_BASE + FEATURE_SLOTS.length).fill(0);
  doubles[0] = launches;
  doubles[1] = sessionMinutes;
  for (let i = 0; i < FEATURE_SLOTS.length; i++) {
    doubles[DOUBLE_FEATURE_BASE + i] = num(features[i], 0, 100000);
  }

  // The index is the SAMPLING key, and there can be only one. Using the event
  // type means high-volume pings get sampled (corrected via _sample_interval)
  // while rare crash/feedback points stay exact. Indexing by client_id would
  // spread sampling evenly and strip that protection from the rare events.
  //
  // Consequence, and it matters: count(DISTINCT client_id) over a sampled
  // dataset undercounts non-linearly. EVERY unique-user number on the
  // dashboard comes from the `device` table below, never from here.
  env.AE.writeDataPoint({
    indexes: ["ping"],
    blobs: [clientId, att.version, osBuild ?? "", locale ?? "", country ?? "", env.BUILD_ENV],
    doubles,
  });

  // The trailing WHERE caps the write budget at one row per device per UTC
  // day: without it every relaunch, retry and offline flush costs a row
  // write. The flip side, and the reason no counter column lives here, is
  // that the UPDATE is skipped entirely on later pings the same day — any
  // `x = x + excluded.x` in this statement would quietly lose most of its
  // increments. Volume is counted in Analytics Engine instead.
  try {
    await env.DB.prepare(
      `INSERT INTO device (client_id, first_day, last_day, days_active,
                           app_version, os_build, locale, country)
       VALUES (?1, ?2, ?2, 1, ?3, ?4, ?5, ?6)
       ON CONFLICT (client_id) DO UPDATE SET
         last_day    = excluded.last_day,
         days_active = device.days_active + 1,
         app_version = excluded.app_version,
         os_build    = excluded.os_build,
         locale      = excluded.locale,
         country     = excluded.country
       WHERE device.last_day < excluded.last_day`,
    )
      .bind(clientId, day, att.version, osBuild, locale, country)
      .run();
  } catch (e) {
    // Fail open, always. A telemetry ping must never be the reason a user's
    // overlay behaves differently.
    console.error("ping: d1 upsert failed", e);
  }

  return new Response(null, { status: 204 });
}
