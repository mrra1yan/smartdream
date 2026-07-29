/**
 * Ad Serve Endpoint — single entry point for all ad traffic.
 *
 * Accepts an ad URL, detects viewer GEO from Cloudflare headers, and
 * routes the request through the optimal delivery path. Currently this
 * means forwarding to /api/embed-frame which adds traffic-quality headers
 * (Referer, Origin, Sec-Fetch-*, clean User-Agent).
 *
 * ## Usage
 *   iframe src="/api/ad-serve?url=ENCODED_AD_URL"
 *
 * ## Why this matters for CPM
 * Previously, ad iframes loaded ad URLs directly — the browser sent its
 * own headers (fine for desktop, but the mobile WebView sends a low-quality
 * default UA). By routing through this endpoint + embed-frame proxy:
 *   - All ads get consistent, high-quality traffic headers
 *   - Mobile WebView ads get a clean Chrome UA (set by the proxy)
 *   - GEO data is available for future format-specific optimization
 *
 * ## Adding more ad networks later
 * When you have API keys for PropellerAds, AdMaven, etc.:
 *   1. Add their serve URL to `src/lib/ad-mediation.ts`
 *   2. Update this endpoint to select the best network per GEO
 *   3. No UI changes needed — iframe src stays the same
 */

import { NextRequest, NextResponse } from "next/server";
import { getOptimalAdUrl } from "@/lib/ad-mediation";
import { z } from "zod";

const QuerySchema = z.object({
  url: z.string().min(5).max(2048),
});

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  const parsed = QuerySchema.safeParse({ url: rawUrl });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  const adUrl = parsed.data.url;

  // Only allow http/https — block javascript:, data:, etc.
  let normalized: URL;
  try {
    normalized = new URL(adUrl);
    if (!["http:", "https:"].includes(normalized.protocol)) {
      throw new Error("bad protocol");
    }
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  // Detect viewer GEO from Cloudflare headers
  const countryCode = request.headers.get("cf-ipcountry");

  // Get the optimal delivery URL (currently routes through embed-frame proxy)
  const { url: serveUrl } = getOptimalAdUrl(adUrl, { countryCode });

  // 307 Temporary Redirect — browsers follow this automatically in iframes.
  // The final destination is /api/embed-frame which fetches the ad
  // server-side and streams it back with proper traffic-quality headers.
  return NextResponse.redirect(new URL(serveUrl, request.url), 307);
}
