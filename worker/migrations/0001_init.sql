-- TheIsle Overlay analytics schema.
--
-- Budget rule that shapes every table below: D1's free tier allows 100,000
-- ROWS WRITTEN per day, and an index costs an EXTRA row write whenever an
-- indexed column is written. Reads are 50x cheaper (5,000,000/day) and count
-- rows SCANNED. So: index freely on cold tables, never on the hot one.

-- ---------------------------------------------------------------- device ---
-- THE hot table: one UPSERT per device per UTC day (see the WHERE clause in
-- src/ping.ts). DELIBERATELY HAS NO SECONDARY INDEX. An index on last_day
-- would cost +1 row write per device per day (50k of a 100k budget at 50k
-- devices); scanning the whole table for DAU costs 50k of a 5,000,000 read
-- budget (1%). Every dashboard query here is a full scan on purpose.
CREATE TABLE IF NOT EXISTS device (
  client_id    TEXT    NOT NULL PRIMARY KEY,  -- UUIDv4, generated at install
  first_day    INTEGER NOT NULL,              -- days since epoch (ts/86400), server clock
  last_day     INTEGER NOT NULL,
  days_active  INTEGER NOT NULL DEFAULT 1,    -- the honest "real user" signal
  app_version  TEXT    NOT NULL,
  os_build     TEXT,                          -- '10.0.26200'
  locale       TEXT,                          -- 'vi-VN'
  country      TEXT                           -- cf.country. RAW IP IS NEVER STORED.
) STRICT;

-- NOTE there is deliberately no launch counter here. The day-rollover guard
-- above skips the UPDATE on every ping after the first of a day, so any column
-- accumulated in that statement would silently miss most of its increments.
-- Launch VOLUME lives in Analytics Engine and is rolled into stat_daily by the
-- cron; this table answers who and when, not how much.

-- ------------------------------------------------------------ stat_daily ---
-- Permanent rollup written by the cron. ~150 rows/day, negligible.
-- Analytics Engine keeps raw data for 3 MONTHS ONLY and that is a one-way
-- door: without this table, last quarter's numbers are gone forever.
CREATE TABLE IF NOT EXISTS stat_daily (
  utc_day INTEGER NOT NULL,
  metric  TEXT    NOT NULL,   -- dau|wau|mau|new|returning|launches|feature|version|country|os
  dim     TEXT    NOT NULL DEFAULT '',
  value   REAL    NOT NULL,
  PRIMARY KEY (utc_day, metric, dim)
) STRICT, WITHOUT ROWID;

-- -------------------------------------------------------------- feedback ---
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT    NOT NULL PRIMARY KEY,
  client_id   TEXT    NOT NULL,
  utc_day     INTEGER NOT NULL,
  ts_server   INTEGER NOT NULL,
  app_version TEXT    NOT NULL,
  category    TEXT    NOT NULL,   -- server-side allowlist, never free text
  body        TEXT    NOT NULL,   -- truncated to 2000 chars server-side
  body_hash   TEXT    NOT NULL,
  contact     TEXT,
  country     TEXT,
  status      TEXT    NOT NULL DEFAULT 'new',   -- new | read
  UNIQUE (client_id, body_hash)   -- kills "clicked submit 40 times" for free
) STRICT;
CREATE INDEX IF NOT EXISTS idx_feedback_triage ON feedback (status, utc_day DESC);

-- ------------------------------------------------------------- crash_agg ---
-- AGGREGATED by fingerprint. Never one row per crash: a machine stuck in a
-- 1-second crash-retry loop emits 86,400 reports/day and would burn the
-- entire write budget in 20 minutes.
CREATE TABLE IF NOT EXISTS crash_agg (
  fingerprint  TEXT    NOT NULL,   -- sha256(error kind + first 5 normalized frames)
  app_version  TEXT    NOT NULL,
  utc_day      INTEGER NOT NULL,
  occurrences  INTEGER NOT NULL DEFAULT 1,
  first_ts     INTEGER NOT NULL,
  last_ts      INTEGER NOT NULL,
  sample_msg   TEXT,   -- truncated to 512
  sample_stack TEXT,   -- truncated to 4096, stored on first occurrence only
  PRIMARY KEY (fingerprint, app_version, utc_day)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_crash_recent ON crash_agg (utc_day DESC, occurrences DESC);
