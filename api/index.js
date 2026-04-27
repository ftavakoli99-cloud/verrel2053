export const config = { runtime: "edge" };

// Cache at module scope (read once at cold start)
const TARGET_BASE = "https://hl.freeper.club:8443";
const TIMEOUT_MS = 25000; // 25s (leave 5s buffer for Vercel's 30s limit)

// Pre-compile header filter as a Set for O(1) lookup
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

const GET_HEAD = new Set(["GET", "HEAD"]);

export default async function handler(req) {
  // Early exit for misconfiguration
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

  // Fast path: construct target URL without URL object allocation
  const pathStart = req.url.indexOf("/", 8);
  const targetUrl =
    pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

  // Single-pass header filtering with minimal allocations
  const headers = new Headers();
  let clientIp = null;

  for (const [key, value] of req.headers) {
    const lowerKey = key.toLowerCase();

    // Reject hop-by-hop, Vercel internal, and x-vercel-* headers
    if (STRIP_HEADERS.has(lowerKey)) continue;

    // Extract real IP once, avoid repeated iteration
    if (lowerKey === "x-real-ip") {
      clientIp = value;
      continue;
    }
    if (lowerKey === "x-forwarded-for" && !clientIp) {
      clientIp = value;
      continue;
    }

    // Preserve all other headers
    headers.set(key, value);
  }

  // Add client IP header if available
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
  }

  // Determine method and whether to forward body
  const method = req.method;
  const hasBody = !GET_HEAD.has(method);

  try {
    // Create abort controller for timeout protection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Stream-based relay with duplex: "half" (true bidirectional)
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual", // Prevent Vercel from chasing 3xx redirects
      signal: controller.signal,
    });

    // Clear timeout on success
    clearTimeout(timeoutId);

    // Return upstream response as-is (streaming)
    return response;
  } catch (err) {
    // Handle timeout vs other errors
    if (err.name === "AbortError") {
      console.error("[relay] timeout: upstream did not respond in 25s");
      return new Response("Gateway Timeout", {
        status: 504,
        headers: { "content-type": "text/plain" },
      });
    }

    console.error("[relay]", err.message);
    return new Response("Bad Gateway: Tunnel Failed", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }
}
