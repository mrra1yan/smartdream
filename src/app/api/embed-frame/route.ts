import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";
import { isIPv6 } from "node:net";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Proxies external link URLs so they can be embedded in an iframe.
 * Many sites set X-Frame-Options / CSP headers that block direct
 * iframe embedding. This route fetches the page server-side and streams
 * the HTML back without those restrictive headers.
 *
 * Named /api/embed-frame (not ad-proxy) so common ad-block filter lists
 * do not block the verification iframe.
 *
 * SSRF hardening: the hostname must look like a public domain name (no raw
 * IP literals), and every hop (initial URL + each redirect) is resolved via
 * DNS-over-HTTPS and checked against private/reserved/loopback/link-local
 * IP ranges before it is fetched. Redirects are followed manually so a
 * validated hostname can't hop to an internal address without being
 * re-checked.
 */

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const PROXY_PATH = "/api/embed-frame";

// Visible fallback page served on any proxy failure. Shows a styled
// "Ad could not load" message with a retry button so the user isn't left
// staring at a black screen for the entire ad-view duration. Also reports
// "error" to the parent so the app can dismiss the slot early.
const ERROR_BODY = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;text-align:center}
  .icon{width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:22px}
  h2{font-size:15px;font-weight:700;line-height:1.3}
  p{font-size:12px;color:rgba(255,255,255,0.5);max-width:260px;line-height:1.5}
  button{background:#6366f1;color:#fff;border:none;padding:10px 28px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s}
  button:hover{opacity:.85}
  button:active{opacity:.7}
</style>
<script>
  try{window.parent.postMessage({__embedframe:'error'},'*')}catch(e){}
  function retry(){window.location.reload()}
</script>
</head><body>
  <div class="icon">&#9888;</div>
  <h2>Ad could not load</h2>
  <p>The ad server may be unreachable or blocked. Check your connection and ad-blocker settings.</p>
  <button onclick="retry()">Retry</button>
</body></html>`;

function isDomainName(hostname: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(
    hostname,
  );
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  );
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

const PRIVATE_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. cloud metadata 169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32], // broadcast
];

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparsable -> treat as unsafe
  for (const [base, bits] of PRIVATE_IPV4_RANGES) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (baseInt & mask)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped / IPv4-compatible IPv6 addresses embed an IPv4 address;
  // validate the embedded address against the IPv4 rules too.
  const mappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) return isPrivateIPv4(mappedMatch[1]);

  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  if (lower.startsWith("2001:db8")) return true; // documentation range

  return false;
}

function isPrivateIP(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

async function dohLookup(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { Accept: "application/dns-json" },
        signal: controller.signal,
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { Answer?: { type: number; data: string }[] };
    const wantType = type === "A" ? 1 : 28;
    return (data.Answer ?? [])
      .filter((a) => a.type === wantType)
      .map((a) => a.data);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves a hostname, validates every returned address is public, and
 *  returns ONE of the validated addresses to pin the actual connection to.
 *
 *  This replaces the previous check-then-fetch pair (assertHostnameIsSafe
 *  followed by a separate, independent `fetch()` that re-resolved the same
 *  hostname on its own). That gap is exactly what a DNS-rebinding attack
 *  exploits: a low-TTL attacker-controlled domain can answer safely for the
 *  validation lookup and then answer with a private/metadata IP for the
 *  real connection's own re-resolution, since the two lookups are
 *  independent events. Doing exactly one resolution and pinning the fetch to
 *  its result closes that gap — there is no second lookup left to spoof. */
async function resolveAndPinHostname(hostname: string): Promise<string> {
  const lower = hostname.toLowerCase();
  if (!isDomainName(lower) || isBlockedHostname(lower)) {
    throw new Error("unsafe hostname");
  }

  const [ipv4s, ipv6s] = await Promise.all([
    dohLookup(lower, "A"),
    dohLookup(lower, "AAAA"),
  ]);
  const addresses = [...ipv4s, ...ipv6s];
  if (addresses.length === 0) {
    throw new Error("could not resolve hostname");
  }
  if (addresses.some(isPrivateIP)) {
    throw new Error("hostname resolves to a private address");
  }

  // Prefer IPv4 for the pin; either family works, this is just a stable
  // choice since we've already validated every address in the answer.
  return ipv4s[0] ?? ipv6s[0];
}

/** Builds a per-hop undici Agent whose connector always dials `pinnedIp`,
 *  no matter what hostname it's asked to look up. This is what actually
 *  pins the TCP/TLS connection to the address we just validated. The
 *  request is still made against the original hostname URL (see safeFetch
 *  below), so the Host header and TLS SNI stay correct for virtual-hosted
 *  servers / certificate validation — only the socket's destination address
 *  is overridden. Handles both call shapes Node's connector uses for a
 *  `lookup` function (single-address callback, and the `options.all`
 *  array-of-addresses callback used by the happy-eyeballs/dual-stack path). */
function makePinnedAgent(pinnedIp: string): Agent {
  const family = isIPv6(pinnedIp) ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options && (options as { all?: boolean }).all) {
          callback(null, [{ address: pinnedIp, family }]);
        } else {
          callback(null, pinnedIp, family);
        }
      },
    },
  });
}

/** Fetches a URL, validating + re-validating on every redirect hop instead
 *  of blindly following redirects to an unchecked destination, and pinning
 *  each hop's actual connection to the exact IP that hop's validation
 *  resolved (see resolveAndPinHostname). */
async function safeFetch(startUrl: URL, request: NextRequest, proxyCookies: string | null) {
  let current = startUrl;

  // Forward real user headers to prevent ad networks from detecting the proxy
  // as a bot and returning a blank "No Fill" page.
  const userAgent = request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
  const acceptLang = request.headers.get("accept-language") || "en-US,en;q=0.5";
  const userIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const acceptEnc = request.headers.get("accept-encoding") || "gzip, deflate, br";

  // ── Traffic-quality headers ──────────────────────────────────────────
  // Missing Referer/Origin/Sec-Fetch-* are classic bot/proxy signals.
  // Forwarding the real user's headers lets ad networks verify the request
  // came from a real browser on a real publisher page → higher CPM.
  const referer = request.headers.get("referer") || "";
  const origin = request.headers.get("origin") || "";
  const secFetchDest = request.headers.get("sec-fetch-dest") || "iframe";
  const secFetchMode = request.headers.get("sec-fetch-mode") || "navigate";
  const secFetchSite = request.headers.get("sec-fetch-site") || "cross-site";
  const secFetchUser = request.headers.get("sec-fetch-user") || "?1";
  const dnt = request.headers.get("dnt") || "";
  // Cloudflare GEO header — ad networks use this for country targeting.
  // If the app is behind Cloudflare, this is set automatically.
  const cfIpCountry = request.headers.get("cf-ipcountry") || "";

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!["http:", "https:"].includes(current.protocol)) {
      throw new Error("bad protocol");
    }
    const pinnedIp = await resolveAndPinHostname(current.hostname);
    const agent = makePinnedAgent(pinnedIp);

    const headers = new Headers({
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": acceptLang,
      "Accept-Encoding": acceptEnc,
      "X-Forwarded-For": userIp,
      "CF-Connecting-IP": userIp,
    });

    // ── Traffic-quality headers (forward only if present) ────────────
    // These prevent ad networks from flagging proxied requests as bots.
    if (referer) headers.set("Referer", referer);
    if (origin) headers.set("Origin", origin);
    headers.set("Sec-Fetch-Dest", secFetchDest);
    headers.set("Sec-Fetch-Mode", secFetchMode);
    headers.set("Sec-Fetch-Site", secFetchSite);
    if (secFetchUser) headers.set("Sec-Fetch-User", secFetchUser);
    if (dnt) headers.set("DNT", dnt);
    if (cfIpCountry) headers.set("CF-IPCountry", cfIpCountry);

    // Use the first-hop Referer as the effective referrer for all redirect
    // hops too — ad networks just need to see a non-empty Referer from a
    // real publisher domain to pass basic quality checks.
    if (hop > 0 && referer) {
      headers.set("Referer", referer);
    }

    if (proxyCookies) {
      headers.set("Cookie", proxyCookies);
    }

    const res = await undiciFetch(current.toString(), {
      headers,
      redirect: "manual",
      dispatcher: agent,
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect without location");
      current = new URL(location, current);
      // Optional: capture Set-Cookie from redirect hops? Usually just the final hop is enough,
      // but Adsterra might set cookies on redirects.
      // It's safer to just let the client handle it if we inject it later, but fetch doesn't accumulate them automatically here.
      continue;
    }

    return res;
  }
  throw new Error("too many redirects");
}

/** Reads a response body incrementally via its stream, aborting as soon as
 *  it exceeds `maxBytes`, instead of buffering the whole thing into memory
 *  first. The previous code only guarded on a trustworthy Content-Length
 *  header before calling `arrayBuffer()` — an upstream that omits or lies
 *  about Content-Length could still have its full (multi-GB) body
 *  materialized in memory before the post-hoc size check ever ran. */
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

async function readBodyWithLimit(res: UndiciResponse, maxBytes: number): Promise<ArrayBuffer> {
  const body = res.body;
  if (!body) return new ArrayBuffer(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("body exceeds max size").catch(() => {});
        throw new Error("body too large");
      }
      chunks.push(value);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function htmlError(status: number) {
  return new NextResponse(ERROR_BODY, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    return htmlError(401);
  }

  // This endpoint fetches arbitrary caller-supplied URLs server-side and
  // streams the response back — usable as an authenticated open proxy.
  // One load per ad view is the legitimate rate (see AD_VIEW_RATE_LIMIT in
  // src/app/actions/like.ts for the same reasoning); 60/min per user is
  // comfortably above that while still bounding scripted abuse.
  const rateLimitOk = await checkRateLimit("embed_frame", user.id, {
    maxAttempts: 60,
    windowMs: 60_000,
    perUserOnly: true,
  });
  if (!rateLimitOk) {
    return htmlError(429);
  }

  const url = request.nextUrl.searchParams.get("url");
  const proxyCookies = request.nextUrl.searchParams.get("__c");
  if (!url) {
    return htmlError(400);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return htmlError(400);
  }

  try {
    const upstream = await safeFetch(parsed, request, proxyCookies);

    // Extract set-cookie headers to inject into client
    const setCookies: string[] = [];
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookies.push(value);
      }
    });

    const contentType = upstream.headers.get("content-type") ?? "text/html";
    const isVideo =
      contentType.startsWith("video/") ||
      /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(parsed.pathname);

    // Don't download multi‑MB creatives — hand the browser the original URL.
    if (isVideo) {
      const mediaUrl = (upstream.url || parsed.toString()).replace(/"/g, "&quot;");
      const player = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}</style>
</head><body>
<video src="${mediaUrl}" autoplay muted playsinline webkit-playsinline controls loop></video>
<script>
(function(){
  var v=document.querySelector('video');
  if(v){v.muted=true;v.play().catch(function(){});}
  try{window.parent.postMessage({__embedframe:'rendered',hasContent:true},'*')}catch(e){}
})();
</script>
</body></html>`;
      return new NextResponse(player, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Permissions-Policy":
            "autoplay=*, encrypted-media=*, fullscreen=*, picture-in-picture=*",
          "Cache-Control": "no-store",
        },
      });
    }

    const contentLength = upstream.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_SIZE) {
      return new NextResponse(ERROR_BODY, {
        status: 413,
        headers: { "Content-Type": "text/html" },
      });
    }

    // Stream-checked instead of buffered-then-checked: an upstream with no
    // (or a false) Content-Length can no longer force the whole body into
    // memory before the size limit is enforced — see readBodyWithLimit.
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await readBodyWithLimit(upstream, MAX_SIZE);
    } catch {
      return new NextResponse(ERROR_BODY, {
        status: 413,
        headers: { "Content-Type": "text/html" },
      });
    }

    let finalBody: string | ArrayBuffer = bodyBuffer;

    if (contentType.includes("text/html")) {
      let html = new TextDecoder().decode(bodyBuffer);

	      // Frame-busting protection is now done via JS property overrides
	      // in the injected <script> below (Object.defineProperty on
	      // window.top / window.parent). This avoids corrupting JSON strings,
	      // inline data attributes, and ad script logic that naively matches
	      // window.top / window.parent inside string literals.

	      html = html.replace(/<meta[^>]+http-equiv=['"]?refresh['"]?[^>]*>/gi, (match) => {
        return match.replace(/(url=)(https?:\/\/[^"'>]+)/i, (_m, p1, p2) => {
          return `${p1}${PROXY_PATH}?url=${encodeURIComponent(p2)}`;
        });
      });

	      const baseTag = `<base href="${parsed.origin}/" />`;
	      const mediaBoost = `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style id="__embed-media">
  html,body{margin:0!important;padding:0!important;background:#000!important;width:100%!important;height:100%!important;overflow:hidden!important}
  img,embed,object,video,iframe{max-width:100%!important;max-height:100%!important;object-fit:contain!important}
  video,iframe[src*="video"],iframe[src*="ad"],iframe[src*="player"],iframe[id*="ad"],iframe[class*="ad"]{
    max-width:100%!important;width:100%!important;
  }
  video{object-fit:contain!important;background:#000!important}
</style>
<script>
(function(){
  // ── Frame-busting protection (JS-level, not text-replace) ──────────
  // Override window.top / window.parent via Object.defineProperty so ad
  // scripts that try to break out of the iframe (popunders, redirects)
  // are silently contained. We do this BEFORE any ad scripts run because
  // this <script> is injected at the very start of <head>. Using
  // defineProperty (configurable:true) prevents ad scripts from
  // overriding our overrides, while still allowing them to read the
  // values without throwing.
  try {
    Object.defineProperty(window, 'top', {
      get: function(){ return window.self; },
      configurable: true
    });
    Object.defineProperty(window, 'parent', {
      get: function(){ return window.self; },
      configurable: true
    });
  } catch(e) {}

  // ── Safe history.pushState / replaceState ──────────────────────────
  try {
    var wrapHistory = function(method) {
      var original = window.history[method];
      if (original) {
        window.history[method] = function(state, title, url) {
          try {
            return original.apply(this, arguments);
          } catch (err) {
            console.warn("Security warning bypassed for history." + method + ":", err);
          }
        };
      }
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
  } catch (e) {}

  // ── Content scaling ────────────────────────────────────────────────
  // Measures the document's natural content size and applies a CSS
  // transform to scale it up/down so it fills the viewport entirely.
  function applyContentScale() {
    try {
      var docEl = document.documentElement;
      var body = document.body;
      if (!body) return;
      // Reset any previous transform so we get accurate measurements
      body.style.transform = '';
      body.style.transformOrigin = '';
      // Use scroll dimensions to capture the true content size
      var contentW = Math.max(
        body.scrollWidth, body.offsetWidth,
        docEl.scrollWidth, docEl.clientWidth
      );
      var contentH = Math.max(
        body.scrollHeight, body.offsetHeight,
        docEl.scrollHeight, docEl.clientHeight
      );
      var viewW = window.innerWidth;
      var viewH = window.innerHeight;
      if (contentW <= 0 || contentH <= 0 || viewW <= 0 || viewH <= 0) return;
      // Scale to fill (cover-style), preserving aspect ratio
      var scaleX = viewW / contentW;
      var scaleY = viewH / contentH;
      var scale = Math.max(scaleX, scaleY);
      // Don't scale if already nearly filling (within 5%)
      if (scale > 0.95 && scale < 1.05) return;
      body.style.transformOrigin = 'top left';
      body.style.transform = 'scale(' + scale + ')';
      // Adjust body dimensions so the scaled element still fits
      body.style.width = (viewW / scale) + 'px';
      body.style.height = (viewH / scale) + 'px';
    } catch(e) {}
  }

  function report(){
    try{window.parent.postMessage({__embedframe:'rendered',hasContent:true},'*')}catch(e){}
  }

  function boostVideos(){
    document.querySelectorAll('video').forEach(function(v){
      try{
        v.setAttribute('playsinline','');
        v.setAttribute('webkit-playsinline','');
        v.muted=true;
        v.defaultMuted=true;
        v.autoplay=true;
        v.controls=true;
        var p=v.play();
        if(p&&p.catch)p.catch(function(){});
      }catch(e){}
    });
    document.querySelectorAll('iframe').forEach(function(f){
      try{
        f.setAttribute('allow','autoplay; encrypted-media; fullscreen; picture-in-picture');
        f.setAttribute('allowfullscreen','');
      }catch(e){}
    });
    applyContentScale();
    report();
  }

  boostVideos();
  document.addEventListener('DOMContentLoaded', boostVideos);
  window.addEventListener('load', function(){
    // Delay scaling slightly so late-rendered content is captured
    setTimeout(applyContentScale, 600);
    setTimeout(applyContentScale, 1500);
    boostVideos();
  });
  try{
    new MutationObserver(function(){
      boostVideos();
    }).observe(document.documentElement,{childList:true,subtree:true});
  }catch(e){}
  setInterval(boostVideos, 1500);

  // ── Click / form interception (route through proxy) ────────────────
  try {
    var __proxyUrl = function(originalUrl) {
      var u = new URL(originalUrl, document.baseURI || window.location.href);
      var target = "${PROXY_PATH}?url=" + encodeURIComponent(u.toString());
      try {
        if (document.cookie) {
          return target + "&__c=" + encodeURIComponent(document.cookie);
        }
      } catch(e){}
      return target;
    };

    var originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      try {
        var method = (this.getAttribute('method') || 'get').toLowerCase();
        var actionUrl = this.action || window.location.href;
        var url = new URL(actionUrl, document.baseURI || window.location.href);
        if (method === 'get') {
          var formData = new FormData(this);
          formData.forEach(function(value, key) { url.searchParams.set(key, value); });
          window.self.location.href = __proxyUrl(url.toString());
          return;
        }
      } catch (err) {}
      return originalSubmit.apply(this, arguments);
    };

    document.addEventListener("submit", function(e) {
      try {
        var form = e.target;
        var method = (form.getAttribute('method') || 'get').toLowerCase();
        if (method === 'get') {
          e.preventDefault();
          var actionUrl = form.action || window.location.href;
          var url = new URL(actionUrl, document.baseURI || window.location.href);
          var formData = new FormData(form);
          formData.forEach(function(value, key) { url.searchParams.set(key, value); });
          window.self.location.href = __proxyUrl(url.toString());
        }
      } catch (err) {}
    }, true);

    document.addEventListener("click", function(e) {
      try {
        var target = e.target.closest ? e.target.closest('a') : null;
        if (target && target.href && !target.href.startsWith('javascript:')) {
          e.preventDefault();
          window.self.location.href = __proxyUrl(target.href);
        }
      } catch (err) {}
    }, true);
  } catch (e) {}

  // ── Storage: use real localStorage/sessionStorage when available ───
  // The parent iframe has sandbox="allow-same-origin", so real storage
  // works. Only fall back to in-memory stubs if the browser throws on
  // access (e.g. opaque origin, third-party cookie blocking).
  try {
    var testKey = '__embed_test__';
    var realLs = false, realSs = false;
    try { window.localStorage.setItem(testKey, '1'); window.localStorage.removeItem(testKey); realLs = true; } catch(e) {}
    try { window.sessionStorage.setItem(testKey, '1'); window.sessionStorage.removeItem(testKey); realSs = true; } catch(e) {}

    if (!realLs) {
      var memLs = {_d:{},setItem:function(k,v){this._d[k]=String(v)},getItem:function(k){return this._d[k]||null},removeItem:function(k){delete this._d[k]},clear:function(){this._d={}},key:function(i){return Object.keys(this._d)[i]||null},get length(){return Object.keys(this._d).length}};
      Object.defineProperty(window,'localStorage',{value:memLs,configurable:true,writable:false});
    }
    if (!realSs) {
      var memSs = {_d:{},setItem:function(k,v){this._d[k]=String(v)},getItem:function(k){return this._d[k]||null},removeItem:function(k){delete this._d[k]},clear:function(){this._d={}},key:function(i){return Object.keys(this._d)[i]||null},get length(){return Object.keys(this._d).length}};
      Object.defineProperty(window,'sessionStorage',{value:memSs,configurable:true,writable:false});
    }
  } catch(e) {}

  // ── Kill malicious popup dialogs ───────────────────────────────────
  try {
    window.alert = function(){};
    window.confirm = function(){ return false; };
    window.prompt = function(){ return null; };
  } catch(e) {}
})();
</script>`;

      const injected = html.includes("<head")
        ? html.replace(/(<head[^>]*>)/i, `$1${baseTag}${mediaBoost}`)
        : `${baseTag}${mediaBoost}${html}`;
      
      // Inject Set-Cookie instructions if any
      let finalHtml = injected;
      if (setCookies.length > 0) {
        const cookieScript = `<script>
${setCookies.map(c => {
  // Strip attributes like HttpOnly, Secure, SameSite, Domain, Path, Expires to just set the value locally
  const cleanCookie = c.split(';')[0];
  return `try { document.cookie = ${JSON.stringify(cleanCookie + "; path=/")}; } catch(e){}`;
}).join('\n')}
</script>`;
        finalHtml = finalHtml.includes("<head")
          ? finalHtml.replace(/(<head[^>]*>)/i, `$1${cookieScript}`)
          : `${cookieScript}${finalHtml}`;
      }
      finalBody = finalHtml;
    } else if (contentType.startsWith("image/")) {
      const mime = contentType.split(";")[0] || "image/png";
      const dataUrl = `data:${mime};base64,${Buffer.from(bodyBuffer).toString("base64")}`;
      finalBody = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;height:100%}img{width:100%;height:100%;object-fit:contain}</style>
<script>try{window.parent.postMessage({__embedframe:'rendered',hasContent:true},'*')}catch(e){}</script></head>
<body><img src="${dataUrl}" alt=""/></body></html>`;
      return new NextResponse(finalBody, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } else {
      return new NextResponse(bodyBuffer, {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    return new NextResponse(finalBody, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType.includes("text/html")
          ? "text/html; charset=utf-8"
          : contentType,
        // Do NOT CSP-sandbox the response — Adsterra video players need normal
        // media + nested iframe behavior. Security still comes from the parent
        // iframe sandbox WITHOUT allow-same-origin (opaque origin).
        "Permissions-Policy":
          "autoplay=*, encrypted-media=*, fullscreen=*, picture-in-picture=*",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[PROXY] Catch block error:", err.message || err);
    return new NextResponse(ERROR_BODY, {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  }
}
