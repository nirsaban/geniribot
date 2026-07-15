import { decryptSecret, loadEnv, secretsKey } from "@kesher/core";
import { GoogleCalendarProvider, type CalendarProvider } from "@kesher/calendar";
import { prisma } from "@kesher/db";

/**
 * Resolve a tenant's calendar provider (the org owner's connected Google
 * Calendar), or null when none is connected / Google isn't configured. Callers
 * degrade gracefully — booking works with or without a calendar.
 */
export async function orgCalendar(organizationId: string): Promise<CalendarProvider | null> {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return null;
  }
  const integ = await prisma.calendarIntegration.findFirst({
    where: { organizationId, provider: "google" },
    orderBy: { id: "asc" },
  });
  if (!integ) return null;

  const key = secretsKey(env.SECRETS_KEY, env.JWT_SECRET);
  try {
    const refreshToken = decryptSecret(integ.refreshToken, key);
    const accessToken = integ.accessToken ? decryptSecret(integ.accessToken, key) : undefined;
    return GoogleCalendarProvider.fromTokens(
      {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
      },
      { refreshToken, accessToken, expiryDate: integ.expiresAt?.getTime() },
      integ.calendarId ?? "primary",
    );
  } catch {
    return null;
  }
}
