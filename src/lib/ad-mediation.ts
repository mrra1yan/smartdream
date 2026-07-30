/**
 * Ad Mediation Layer — routes ad impressions through the optimal delivery
 * path for maximum CPM without changing any user-facing features.
 *
 * ## What it does
 * 1. Classifies the viewer's GEO into CPM tiers (Tier 1/2/3)
 * 2. Routes all ads through `/api/embed-frame` so they get proper
 *    traffic-quality headers (Referer, Origin, Sec-Fetch-*, User-Agent)
 *    regardless of whether the viewer is on browser or mobile WebView
 * 3. Provides a single place to add/remove ad networks without touching
 *    the UI layer
 *
 * ## How GEO classification affects CPM
 * Advertisers bid dramatically different rates by country:
 *   Tier 1 (US, UK, CA, AU, DE, ...) → $2–10 CPM
 *   Tier 2 (IN, BR, MX, ID, ...)      → $0.3–1 CPM
 *   Tier 3 (BD, PK, NG, ...)           → $0.05–0.3 CPM
 *
 * By tracking GEO at the server, we can later add format-specific
 * routing (e.g. popunders for Tier 1, direct links for Tier 3).
 */

// ── GEO Classification ──────────────────────────────────────────────────

/** Countries where advertisers pay premium CPM. */
const TIER_1 = new Set([
  "US", "CA", "GB", "AU", "NZ",
  "DE", "FR", "NL", "BE", "LU", "AT", "CH", "DK", "SE", "NO", "FI", "IE",
  "JP", "KR", "SG", "HK",
  "AE", "QA", "KW", "SA",
]);

/** Mid-tier countries — decent fill but lower CPM. */
const TIER_2 = new Set([
  "IN", "BR", "MX", "ID", "TH", "VN", "PH", "MY",
  "ZA", "TR", "AR", "CL", "CO", "PE", "EG", "MA",
  "PL", "CZ", "RO", "HU", "GR", "PT", "SK", "SI", "HR", "BG",
  "UA", "RU", "KZ", "AZ",
]);

export type Geo = "tier1" | "tier2" | "tier3" | "unknown";

/** Classify a country code into a CPM tier. */
export function classifyGeo(countryCode: string | null): Geo {
  if (!countryCode) return "unknown";
  const cc = countryCode.toUpperCase();
  if (TIER_1.has(cc)) return "tier1";
  if (TIER_2.has(cc)) return "tier2";
  return "tier3";
}

// ── Ad URL Normalization ────────────────────────────────────────────────

/**
 * Normalize an ad URL for optimal delivery.
 *
 * Currently routes through the embed-frame proxy so ads receive proper
 * traffic-quality headers (Referer, Origin, Sec-Fetch-*, clean User-Agent).
 * Previously, ads loaded directly in iframes/WebViews bypassed the proxy
 * entirely, missing out on header normalization — especially on mobile
 * where the default WebView UA signals "in-app traffic" → lower CPM.
 */
export function getOptimalAdUrl(
  originalUrl: string,
  options?: { countryCode?: string | null; isMobile?: boolean },
): {
  url: string;
  geo: Geo;
  proxyPath: string;
} {
  const geo = classifyGeo(options?.countryCode ?? null);

  // Route through the embed-frame proxy for:
  // - Consistent traffic-quality headers (especially on mobile)
  // - SSRF protection (private IP blocking, DNS pinning)
  // - Cookie forwarding between redirect hops
  // - Adsterra compatibility (localStorage stubs, frame-busting)
  const proxyPath = `/api/embed-frame?url=${encodeURIComponent(originalUrl)}`;

  return { url: proxyPath, geo, proxyPath };
}

// ── Analytics Placeholder ───────────────────────────────────────────────
//
// Hook this to your analytics later to track CPM by GEO:
//
//   trackImpression({ linkId, geo, network: 'adsterra', timestamp })
//
// Once you have per-GEO CPM data, you can set up format-specific routing:
//
//   if (geo === 'tier1') {
//     // Serve as popunder → 3x CPM
//     return adsterraPopunderUrl(originalUrl)
//   }
//   // Fall back to embed-frame proxy for Tier 2/3
//   return embedFrameProxyUrl(originalUrl)
