export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  AE: AnalyticsEngineDataset;
  RL_PING: RateLimiter;
  RL_WRITE: RateLimiter;
  BUILD_ENV: string;
  /** Root secret. Per-version client keys are derived from it, never shipped. */
  ATTEST_MASTER: string;
  /** Bearer token for /admin/*. */
  ADMIN_TOKEN: string;
  /** Cloudflare API token with Account Analytics Read, for the AE SQL API. */
  AE_QUERY_TOKEN?: string;
  AE_ACCOUNT_ID?: string;
}
