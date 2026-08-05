import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    latestVersion: process.env.APP_LATEST_VERSION || "1.0.0",
    forceUpdate: process.env.APP_FORCE_UPDATE === "false" ? false : true,
    downloadUrl: process.env.APP_DOWNLOAD_URL || "https://github.com/nurulhudda247/SmartDream-Releases/releases/latest/download/SmartDream.apk",
    releaseNotes: process.env.APP_RELEASE_NOTES || "A new version of the app is available. Please update to continue.",
    webUrl: process.env.APP_WEB_URL || "https://sd.docstec.cloud"
  });
}
