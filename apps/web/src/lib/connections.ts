import { prisma } from "@kesher/db";

export interface ConnectionOption {
  id: string;
  label: string;
  phoneNumber: string | null;
}

/**
 * The org's numbers, for the "which number is this scenario for?" pickers.
 *
 * Every connection is listed, not just CONNECTED ones: a business commonly
 * builds the script for a number while it is still pairing, and hiding the row
 * until it goes live would make binding impossible exactly when it is wanted.
 */
export async function orgConnections(org: string): Promise<ConnectionOption[]> {
  return prisma.whatsAppConnection.findMany({
    where: { organizationId: org },
    select: { id: true, label: true, phoneNumber: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * How a number reads in a picker or badge. Two connections routinely share the
 * default label ("וואטסאפ"), so the number itself is what tells them apart and
 * is appended whenever pairing has revealed it.
 */
export function connectionName(c: ConnectionOption): string {
  return c.phoneNumber ? `${c.label} · ${c.phoneNumber}` : c.label;
}
