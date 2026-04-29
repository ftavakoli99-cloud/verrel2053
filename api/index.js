export const config = { runtime: "edge" };

const UPSTREAM = "https://hl.freeper.club:2053";

const BLOCKED_HEADERS = new Set([
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
  const pos = req.url.indexOf("/", 8);
  const dest = pos === -1 ? UPSTREAM + "/" : UPSTREAM + req.url.slice(pos);

  const fwdHeaders = new Headers();
  let clientIp = "";

  for (const [k, v] of req.headers) {
    if (k === "x-real-ip") { clientIp = v; continue; }
    if (k === "x-forwarded-for") { if (!clientIp) clientIp = v; continue; }
    if (!BLOCKED_HEADERS.has(k)) fwdHeaders.set(k, v);
  }

  if (clientIp) fwdHeaders.set("x-forwarded-for", clientIp);

  const verb = req.method;

  try {
    return await fetch(dest, {
      method: verb,
      headers: fwdHeaders,
      body: verb === "GET" || verb === "HEAD" ? undefined : req.body,
      duplex: "half",
      redirect: "manual",
    });
  } catch {
    return new Response("Bad Gateway: Tunnel Failed", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }
}
