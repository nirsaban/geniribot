import { NextResponse } from "next/server";
import { exchangeCode } from "@kesher/calendar";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { encToken, googleClient, googleConfigured } from "@/lib/google";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Google OAuth callback: exchange the code and store encrypted tokens. */
export async function GET(req: Request) {
  const session = await getSession();
  const settings = new URL(withBase("/dashboard/settings"), req.url);
  if (!session) return NextResponse.redirect(new URL(withBase("/login"), req.url));
  if (!googleConfigured()) {
    settings.searchParams.set("google", "not_configured");
    return NextResponse.redirect(settings);
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || state !== session.sub) {
    settings.searchParams.set("google", "error");
    return NextResponse.redirect(settings);
  }

  try {
    const tokens = await exchangeCode(googleClient(), code);
    await prisma.calendarIntegration.upsert({
      where: { id: `${session.sub}:google` },
      update: {
        accessToken: tokens.accessToken ? encToken(tokens.accessToken) : "",
        refreshToken: encToken(tokens.refreshToken),
        expiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : null,
      },
      create: {
        id: `${session.sub}:google`,
        organizationId: session.org,
        userId: session.sub,
        provider: "google",
        accessToken: tokens.accessToken ? encToken(tokens.accessToken) : "",
        refreshToken: encToken(tokens.refreshToken),
        expiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : null,
      },
    });
    settings.searchParams.set("google", "connected");
  } catch {
    settings.searchParams.set("google", "error");
  }
  return NextResponse.redirect(settings);
}
