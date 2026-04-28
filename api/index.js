export const config = { runtime: "edge" };

// Read once at cold start — never changes
const TARGET_BASE = "https://hl.freeper.club:2053";

// Hop-by-hop and Vercel-internal headers to drop.
// x-real-ip and x-forwarded-for are handled separately before this check.
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-vercel-id",
  "x-vercel-trace",
  "x-vercel-ip",
]);

export default async function handler(req) {
  // Path extraction — avoids URL object allocation
  const slash = req.url.indexOf("/", 8);
  const targetUrl =
    slash === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(slash);

  // Single-pass header filter.
  // Edge runtime delivers header keys pre-lowercased — no toLowerCase() needed.
  const headers = new Headers();
  let ip = "";

  for (const [k, v] of req.headers) {
    // Capture real client IP before stripping Vercel-added forwarding headers
    if (k === "x-real-ip") { ip = v; continue; }
    if (k === "x-forwarded-for") { if (!ip) ip = v; continue; }

    if (!STRIP_HEADERS.has(k)) headers.set(k, v);
  }

  if (ip) headers.set("x-forwarded-for", ip);

  const method = req.method;

  try {
    // No AbortController needed — Vercel enforces the wall-clock limit via
    // maxDuration: 30 in vercel.json at the platform level, which is cheaper
    // than allocating a controller + timer on every request.
    return await fetch(targetUrl, {
      method,
      headers,
      // Inline check beats a two-element Set lookup
      body: method === "GET" || method === "HEAD" ? undefined : req.body,
      duplex: "half",
      redirect: "manual",
    });
  } catch {
    // AbortError is gone (no controller), so all errors are upstream failures
    return new Response("Bad Gateway: Tunnel Failed", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }
}
