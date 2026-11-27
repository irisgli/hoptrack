// Local dev server: static files plus the same /api/ics function Vercel runs.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// Load .env.local (written by `vercel env pull`) so local sync uses the same store.
const envFile = fileURLToPath(new URL("./.env.local", import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const sync = (await import("./api/sync.js")).default;

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4188);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/api/sync") return sync(req, res);
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  if (rel.startsWith("/api") || rel.includes("server.mjs") || rel.includes(".env") || rel.startsWith("/node_modules") || rel.startsWith("/.vercel")) { res.statusCode = 404; return res.end("not found"); }
  try {
    const data = await readFile(join(root, rel));
    res.setHeader("content-type", types[extname(rel)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`hop to it on http://localhost:${port}`));
