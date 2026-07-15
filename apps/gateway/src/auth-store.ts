import { Prisma, prisma } from "@kesher/db";
import type { AuthState, AuthStore } from "@kesher/whatsapp";

/**
 * Postgres-backed Baileys auth state. Persists the whole session blob in
 * WhatsAppConnection.authState so sessions survive a gateway restart without
 * re-scanning the QR. See docs/ARCHITECTURE.md §6.
 */
export class PrismaAuthStore implements AuthStore {
  async load(connectionId: string): Promise<AuthState | null> {
    const row = await prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
      select: { authState: true },
    });
    return (row?.authState as AuthState | null) ?? null;
  }

  async save(connectionId: string, state: AuthState): Promise<void> {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { authState: state as Prisma.InputJsonValue },
    });
  }

  async clear(connectionId: string): Promise<void> {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { authState: Prisma.DbNull },
    });
  }
}
