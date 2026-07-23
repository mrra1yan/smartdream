import { NextRequest, NextResponse } from "next/server";

/** Legacy path kept so old bookmarks/clients redirect to the non-blocked name. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/api/embed-frame";
  return NextResponse.redirect(url, 308);
}
