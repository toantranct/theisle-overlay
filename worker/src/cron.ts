import { DOUBLE_FEATURE_BASE, FEATURE_SLOTS } from "./features";
import { nowS, utcDay } from "./util";
import type { Env } from "./env";

const DEVICE_RETENTION_DAYS = 90;
// Feedback is a support inbox, not telemetry: deleting a bug report after 90
// days throws away the only reason it was collected. It still expires, just
// on a longer clock, and it is the one table a user could ask to be erased
// from by name.
const FEEDBACK_RETENTION_DAYS = 180;

async function aeQuery(env: Env, sql: string): Promise<Record<string, number>[] | null> {
  if (!env.AE_QUERY_TOKEN || !env.AE_ACCOUNT_ID) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.AE_ACCOUNT_ID}/analytics_engine/sql`,
      { method: "POST", headers: { Authorization: `Bearer ${env.AE_QUERY_TOKEN}` }, body: sql },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { data?: Record<string, number>[] }).data ?? null;
  } catch (e) {
    console.error("cron: AE query failed", e);
    return null;
  }
}

/**
 * Nightly rollup + prune.
 *
 * The rollup exists because Analytics Engine keeps raw data for THREE MONTHS
 * and that is a one-way door — whatever is not summarised into stat_daily
 * before the window closes is gone for good. Run it from day one even if
 * nobody opens the table for six months.
 */
export async function runCron(env: Env): Promise<void> {
  const today = utcDay(nowS());
  const day = today - 1; // yesterday, complete
  const stmts: D1PreparedStatement[] = [];

  const put = (metric: string, dim: string, value: number) =>
    stmts.push(
      env.DB.prepare(
        `INSERT INTO stat_daily (utc_day, metric, dim, value) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (utc_day, metric, dim) DO UPDATE SET value = excluded.value`,
      ).bind(day, metric, dim, value),
    );

  const agg = (
    await env.DB.prepare(
      `SELECT SUM(CASE WHEN last_day  = ?1      THEN 1 ELSE 0 END) AS dau,
              SUM(CASE WHEN last_day >= ?1 - 6  THEN 1 ELSE 0 END) AS wau,
              SUM(CASE WHEN last_day >= ?1 - 29 THEN 1 ELSE 0 END) AS mau,
              SUM(CASE WHEN first_day = ?1      THEN 1 ELSE 0 END) AS new_installs,
              SUM(CASE WHEN days_active >= 3    THEN 1 ELSE 0 END) AS returning_users
       FROM device`,
    )
      .bind(day)
      .first<Record<string, number | null>>()
  ) ?? {};
  // Left side is the stat_daily metric name, right side the SQL alias:
  // "new" and "returning" are SQLite keywords and cannot be aliases.
  const metrics: [string, string][] = [
    ["dau", "dau"], ["wau", "wau"], ["mau", "mau"],
    ["new", "new_installs"], ["returning", "returning_users"],
  ];
  for (const [metric, col] of metrics) put(metric, "", Number(agg[col] ?? 0));

  for (const [metric, col] of [
    ["version", "app_version"],
    ["country", "country"],
    ["os", "os_build"],
  ] as const) {
    const res = await env.DB.prepare(
      `SELECT COALESCE(${col}, '?') AS dim, COUNT(*) AS n FROM device WHERE last_day = ?1 GROUP BY 1`,
    )
      .bind(day)
      .all<{ dim: string; n: number }>();
    for (const r of res.results ?? []) put(metric, r.dim, r.n);
  }

  // Feature usage and launch volume exist ONLY in Analytics Engine — the
  // `device` table cannot hold a counter (see migrations/0001_init.sql).
  //
  // Explicit toDateTime bounds rather than `NOW() - INTERVAL '1' DAY`: this
  // job runs at 02:10 UTC, so a rolling 24h window would straddle two
  // calendar days and every daily figure would be a blend of both.
  const dayStart = new Date(day * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  const dayEnd = new Date((day + 1) * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  const cols = FEATURE_SLOTS.map(
    (name, i) => `sum(_sample_interval * double${DOUBLE_FEATURE_BASE + i + 1}) AS "${name}"`,
  ).join(", ");
  const ae = await aeQuery(
    env,
    `SELECT sum(_sample_interval * double1) AS launches, ${cols}
     FROM overlay
     WHERE index1 = 'ping' AND blob6 = '${env.BUILD_ENV}'
       AND timestamp >= toDateTime('${dayStart}') AND timestamp < toDateTime('${dayEnd}')`,
  );
  if (ae?.[0]) {
    put("launches", "", Number(ae[0].launches ?? 0));
    for (const name of FEATURE_SLOTS) put("feature", name, Number(ae[0][name] ?? 0));
  }

  stmts.push(
    env.DB.prepare(`DELETE FROM device WHERE last_day < ?1`).bind(today - DEVICE_RETENTION_DAYS),
    env.DB.prepare(`DELETE FROM crash_agg WHERE utc_day < ?1`).bind(today - DEVICE_RETENTION_DAYS),
    env.DB.prepare(`DELETE FROM feedback WHERE utc_day < ?1`).bind(today - FEEDBACK_RETENTION_DAYS),
  );

  await env.DB.batch(stmts);
}
