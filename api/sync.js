// Keeps your progress in a private Vercel Blob so every device sees the same
// data without exporting anything. Each sync key maps to one hashed file name;
// only someone holding the key can read or write it.
import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

const KEY_RE = /^[A-Za-z0-9_-]{32,80}$/;
const MAX_BYTES = 3 * 1024 * 1024;

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BYTES) throw new Error("too big");
  }
  return JSON.parse(raw || "{}");
}

async function pull(path) {
  const r = await get(path, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return { state: null, etag: null };
  const state = JSON.parse(await new Response(r.stream).text());
  return { state, etag: String(state.updatedAt || 0) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "use POST" });
  let body;
  try { body = await readBody(req); } catch { return send(res, 413, { error: "too big or not JSON" }); }
  const key = String(body.key || "");
  if (!KEY_RE.test(key)) return send(res, 400, { error: "bad sync key" });
  const path = `sync/${createHash("sha256").update(key).digest("hex")}.json`;

  try {
    if (body.op === "pull") return send(res, 200, await pull(path));
    if (body.op === "push") {
      if (!body.state || typeof body.state !== "object") return send(res, 400, { error: "missing state" });
      const json = JSON.stringify(body.state);
      if (json.length > MAX_BYTES) return send(res, 413, { error: "too big" });
      // Newest edit wins: refuse to overwrite a copy that was saved more recently.
      const current = await pull(path);
      if (current.state && (current.state.updatedAt || 0) > (body.state.updatedAt || 0)) return send(res, 409, current);
      await put(path, json, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
      return send(res, 200, { etag: String(body.state.updatedAt || 0) });
    }
    return send(res, 400, { error: "unknown op" });
  } catch (e) {
    console.error("sync failed", e && e.name, e && e.message);
    return send(res, 502, { error: "storage is unavailable right now" });
  }
}
