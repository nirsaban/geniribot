import { NextResponse } from "next/server";
import { buildAuthUrl } from "@kesher/calendar";
import { withBase } from "@/lib/basePath";
import { googleClient, googleConfigured } from "@/lib/google";
import { requireFeature } from "@/lib/plan";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Kick off Google Calendar OAuth: redirect the user to Google's consent page. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(withBase("/login"), req.url));
  if (!(await requireFeature(session.org, "calendarSync"))) {
    return NextResponse.redirect(new URL(withBase("/dashboard/billing"), req.url));
  }
  if (!googleConfigured()) {
    return NextResponse.json({ error: "google_not_configured" }, { status: 400 });
  }
  // state carries the user id so the callback can attribute the tokens.
  const url = buildAuthUrl(googleClient(), session.sub);
  return NextResponse.redirect(url);
}
