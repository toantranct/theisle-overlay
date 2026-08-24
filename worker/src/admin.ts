import { FEATURE_SLOTS, DOUBLE_FEATURE_BASE } from "./features";
import { json, nowS, timingSafeEqual, utcDay } from "./util";
import type { Env } from "./env";

function authed(req: Request, env: Env): boolean {
  const got = req.headers.get("authorization") ?? "";
  return got.startsWith("Bearer ") && timingSafeEqual(got.slice(7), env.ADMIN_TOKEN);
}

type Row = Record<string, string | number | null>;
const rows = async (env: Env, sql: string, ...bind: unknown[]): Promise<Row[]> =>
  ((await env.DB.prepare(sql).bind(...bind).all()).results ?? []) as Row[];

/**
 * Live feature usage from Analytics Engine.
 *
 * Queried on demand rather than read from the nightly rollup so the dashboard
 * reflects today. Costs one subrequest, and only an admin ever triggers it.
 * Returns null when no query token is configured; the caller then falls back
 * to stat_daily, which is a day behind but always available.
 */
async function featuresFromAE(env: Env, days: number): Promise<Row[] | null> {
  if (!env.AE_QUERY_TOKEN || !env.AE_ACCOUNT_ID) return null;
  // AE columns are 1-based (double1 = doubles[0]), hence the +1.
  const cols = FEATURE_SLOTS.map(
    (name, i) => `sum(_sample_interval * double${DOUBLE_FEATURE_BASE + i + 1}) AS "${name}"`,
  ).join(", ");
  const sql = `SELECT ${cols} FROM overlay
               WHERE index1 = 'ping' AND blob6 = '${env.BUILD_ENV}'
                 AND timestamp > NOW() - INTERVAL '${days}' DAY`;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.AE_ACCOUNT_ID}/analytics_engine/sql`,
      { method: "POST", headers: { Authorization: `Bearer ${env.AE_QUERY_TOKEN}` }, body: sql },
    );
    if (!res.ok) return null;
    const out = (await res.json()) as { data?: Record<string, number>[] };
    const first = out.data?.[0];
    if (!first) return null;
    return FEATURE_SLOTS.map((name) => ({ dim: name, value: Number(first[name] ?? 0) }));
  } catch (e) {
    console.error("admin: AE query failed", e);
    return null;
  }
}

export async function handleAdmin(req: Request, env: Env, path: string): Promise<Response> {
  if (!authed(req, env)) return new Response(null, { status: 401 });

  if (path === "/admin/feedback/read" && req.method === "POST") {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    await env.DB.prepare(`UPDATE feedback SET status = 'read' WHERE id = ?1`).bind(id).run();
    return new Response(null, { status: 204 });
  }
  if (path !== "/admin/data") return new Response(null, { status: 404 });

  // Number("abc") is NaN, and Math.max(7, NaN) is NaN — which would then be
  // bound into a D1 query. Check for finite before clamping, not after.
  const requested = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(requested) ? Math.min(90, Math.max(7, Math.trunc(requested))) : 30;
  const today = utcDay(nowS());

  // Every query below is a full scan of `device` on purpose: the table has no
  // secondary index because an index would cost a row WRITE every day for
  // every device, and writes are the scarce resource. See migrations/0001.
  const [summary, versions, os, locale, country, series, featureRollup, crashes, feedback, launches] =
    await Promise.all([
      rows(
        env,
        `SELECT COUNT(*) AS installs,
                SUM(CASE WHEN last_day  = ?1      THEN 1 ELSE 0 END) AS dau,
                SUM(CASE WHEN last_day >= ?1 - 6  THEN 1 ELSE 0 END) AS wau,
                SUM(CASE WHEN last_day >= ?1 - 29 THEN 1 ELSE 0 END) AS mau,
                SUM(CASE WHEN first_day = ?1      THEN 1 ELSE 0 END) AS new_today,
                -- "returning" and "new" are SQLite keywords; alias around them.
                SUM(CASE WHEN days_active >= 3    THEN 1 ELSE 0 END) AS returning_users
         FROM device`,
        today,
      ),
      rows(
        env,
        `SELECT app_version AS dim, COUNT(*) AS value FROM device
         WHERE last_day >= ?1 - 6 GROUP BY 1 ORDER BY 2 DESC`,
        today,
      ),
      rows(
        env,
        `SELECT COALESCE(os_build,'?') AS dim, COUNT(*) AS value FROM device
         WHERE last_day >= ?1 - 6 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        today,
      ),
      rows(
        env,
        `SELECT COALESCE(locale,'?') AS dim, COUNT(*) AS value FROM device
         WHERE last_day >= ?1 - 6 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        today,
      ),
      rows(
        env,
        `SELECT COALESCE(country,'?') AS dim, COUNT(*) AS value FROM device
         WHERE last_day >= ?1 - 6 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        today,
      ),
      rows(
        env,
        `SELECT utc_day, metric, value FROM stat_daily
         WHERE utc_day >= ?1 - ?2 AND metric IN ('dau','new','launches')
         ORDER BY utc_day`,
        today,
        days,
      ),
      rows(
        env,
        `SELECT dim, SUM(value) AS value FROM stat_daily
         WHERE metric = 'feature' AND utc_day >= ?1 - 6 GROUP BY 1 ORDER BY 2 DESC`,
        today,
      ),
      rows(
        env,
        `SELECT fingerprint, app_version, utc_day, occurrences, sample_msg, sample_stack
         FROM crash_agg WHERE utc_day >= ?1 - 13
         ORDER BY occurrences DESC LIMIT 25`,
        today,
      ),
      rows(
        env,
        `SELECT id, client_id, ts_server, app_version, category, body, contact, country, status
         FROM feedback ORDER BY ts_server DESC LIMIT 50`,
      ),
      // Launch volume comes from the rollup, not from `device` — see the note
      // in migrations/0001_init.sql for why no counter can live on that table.
      rows(
        env,
        `SELECT SUM(value) AS value FROM stat_daily
         WHERE metric = 'launches' AND utc_day >= ?1 - ?2`,
        today,
        days,
      ),
    ]);

  const featuresLive = await featuresFromAE(env, 7);

  return json({
    today,
    days,
    build_env: env.BUILD_ENV,
    summary: { ...(summary[0] ?? {}), launches_window: launches[0]?.value ?? null },
    versions,
    os,
    locale,
    country,
    series,
    features: featuresLive ?? featureRollup,
    features_live: featuresLive !== null,
    feature_slots: FEATURE_SLOTS,
    crashes,
    feedback,
  });
}
