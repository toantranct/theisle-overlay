import { verify } from "./attest";
import { clientIdKey, isClientId, nowS, sha256Hex, str, utcDay } from "./util";
import type { Env } from "./env";

/** Server-side allowlist. A category that arrives as free text becomes a
 *  storage bucket for whatever the first fork feels like sending. */
const CATEGORIES = new Set(["bug", "idea", "other"]);

export async function handleFeedback(req: Request, env: Env): Promise<Response> {
  const att = await verify(req, env, "/v1/feedback");
  if (!att.ok) return new Response(null, { status: att.status });

  const b = att.body;
  if (!isClientId(b.client_id)) return new Response(null, { status: 400 });
  const clientId = clientIdKey(b.client_id);

  const { success } = await env.RL_WRITE.limit({ key: clientId });
  if (!success) return new Response(null, { status: 429 });

  const category = typeof b.category === "string" && CATEGORIES.has(b.category) ? b.category : "other";
  const body = str(b.body, 2000);
  if (!body) return new Response(null, { status: 400 });
  const contact = str(b.contact, 200);

  const ts = nowS();
  const country = (req as Request & { cf?: { country?: string } }).cf?.country ?? null;
  // Hash of the normalized text: the UNIQUE(client_id, body_hash) constraint
  // then swallows a double-tapped submit button without any extra query.
  const bodyHash = await sha256Hex(body.toLowerCase().replace(/\s+/g, " "));

  env.AE.writeDataPoint({
    indexes: ["feedback"],
    blobs: [clientId, att.version, category, country ?? "", env.BUILD_ENV],
    doubles: [1],
  });

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO feedback
         (id, client_id, utc_day, ts_server, app_version, category, body, body_hash, contact, country)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        crypto.randomUUID(),
        clientId,
        utcDay(ts),
        ts,
        att.version,
        category,
        body,
        bodyHash,
        contact,
        country,
      )
      .run();
  } catch (e) {
    console.error("feedback: d1 insert failed", e);
    return new Response(null, { status: 503 });
  }

  return new Response(null, { status: 204 });
}
