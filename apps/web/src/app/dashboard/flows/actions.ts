"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deriveFieldSchema, FlowDefinition } from "@kesher/flow-engine";
import { prisma, type Prisma } from "@kesher/db";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.org;
}

async function ownFlow(org: string, id: string) {
  const f = await prisma.flow.findFirst({ where: { id, organizationId: org } });
  if (!f) redirect("/dashboard/flows");
  return f;
}

/**
 * Resolve a submitted connection id to one this org actually owns.
 *
 * Empty means "all numbers" and is stored as null. A value the org does not own
 * is dropped to null rather than trusted: this comes off a form, and binding a
 * scenario to another tenant's number would leak the flow into their routing.
 */
async function ownedConnectionId(org: string, raw: FormDataEntryValue | null): Promise<string | null> {
  const id = String(raw ?? "").trim();
  if (!id) return null;
  const conn = await prisma.whatsAppConnection.findFirst({
    where: { id, organizationId: org },
    select: { id: true },
  });
  return conn?.id ?? null;
}

/** Persist an edited flow definition (validated) and bump its version. */
export async function saveFlowAction(
  id: string,
  definitionJson: string,
): Promise<{ error?: string; activated?: boolean }> {
  const org = await requireOrg();
  const flow = await ownFlow(org, id);

  let raw: unknown;
  try {
    raw = JSON.parse(definitionJson);
  } catch {
    return { error: "invalid_json" };
  }
  // Validate the engine-relevant shape (extra keys like _positions are ignored).
  const parsed = FlowDefinition.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "invalid_flow" };
  }
  if (!(parsed.data.start in parsed.data.nodes)) {
    return { error: "start node missing" };
  }

  // Auto-activate on save if nothing else already answers on this scenario's
  // number — so a freshly built bot actually goes live instead of silently
  // sitting inactive.
  //
  // Scoped to the number rather than the whole org, because org-wide was wrong
  // the moment a second number existed: a business that already had a live
  // scenario built a second one for their new line, and it stayed switched off
  // with no indication why. For a flow bound to a number, "already covered"
  // means covered *on that number* — by its own scripts or by an org-wide one.
  const activeElsewhere = await prisma.flow.count({
    where: {
      organizationId: org,
      isActive: true,
      id: { not: flow.id },
      ...(flow.connectionId ? { OR: [{ connectionId: flow.connectionId }, { connectionId: null }] } : {}),
    },
  });
  await prisma.flow.update({
    where: { id: flow.id },
    data: {
      definition: raw as Prisma.InputJsonValue,
      // Re-derived on every save so the CRM's columns can never drift from the
      // questions the bot actually asks.
      fieldSchema: deriveFieldSchema(parsed.data) as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      ...(activeElsewhere === 0 ? { isActive: true } : {}),
    },
  });
  revalidatePath("/dashboard/flows");
  revalidatePath(`/dashboard/flows/${id}/edit`);
  return { activated: activeElsewhere === 0 };
}

export async function renameFlowAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const flow = await ownFlow(org, id);
  if (!name || name === flow.name) return;
  await prisma.flow.update({ where: { id: flow.id }, data: { name } });
  // `Contact.source` is a denormalized copy of this name — keep leads' source
  // labels in sync so the CRM doesn't show a name that no longer exists.
  await prisma.contact.updateMany({
    where: { organizationId: org, sourceFlowId: flow.id },
    data: { source: name },
  });
  revalidatePath("/dashboard/flows");
  revalidatePath(`/dashboard/flows/${id}/edit`);
  revalidatePath("/dashboard/leads");
}

/**
 * Permanently delete a flow. Leads keep their collected fields and their
 * `source` name; only the live link (`sourceFlowId`) is cleared so filters and
 * schema lookups don't point at a row that no longer exists.
 */
export async function deleteFlowAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const flow = await ownFlow(org, id);
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { organizationId: org, sourceFlowId: flow.id },
      data: { sourceFlowId: null },
    }),
    prisma.conversation.updateMany({
      where: { organizationId: org, flowId: flow.id },
      data: { flowId: null },
    }),
    prisma.flow.delete({ where: { id: flow.id } }),
  ]);
  revalidatePath("/dashboard/flows");
  revalidatePath("/dashboard/leads");
}

export async function toggleFlowActiveAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const flow = await ownFlow(org, id);
  await prisma.flow.update({ where: { id: flow.id }, data: { isActive: !flow.isActive } });
  revalidatePath("/dashboard/flows");
}

const TEMPLATES: Record<string, { name: string; definition: unknown }> = {
  lead: {
    name: "איסוף ליד + קביעת פגישה",
    definition: {
      start: "n1",
      trigger: { type: "any" },
      nodes: {
        n1: { type: "question", field: "city", prompt: "היי! 👋 מאיפה אתה?", expect: "text", next: "n2" },
        n2: { type: "question", field: "name", prompt: "נעים מאוד! ומה השם שלך?", expect: "text", next: "n3" },
        n3: { type: "question", field: "need", prompt: "מעולה! ואיך נוכל לעזור?", expect: "text", next: "n4" },
        n4: { type: "message", text: "אשמח לקבוע איתך פגישה קצרה 📅", next: "n5" },
        n5: { type: "action", action: "book_appointment", next: "n6" },
        n6: { type: "message", text: "תודה רבה! נתראה 🙏", next: null },
      },
    },
  },
  support: {
    name: "תמיכה מהירה",
    definition: {
      start: "n1",
      trigger: { type: "keyword", keywords: ["תמיכה", "בעיה", "עזרה"] },
      nodes: {
        n1: { type: "question", field: "issue", prompt: "שלום! נשמח לעזור 🙌 מה הנושא?", expect: "text", next: "n2" },
        n2: { type: "message", text: "קיבלנו! נציג יחזור אליך בהקדם 🙏", next: null },
      },
    },
  },
};

export async function createFlowAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const key = String(formData.get("template") ?? "lead");
  const tpl = TEMPLATES[key] ?? TEMPLATES.lead!;

  const productId = String(formData.get("productId") ?? "").trim() || null;
  let product: { name: string } | null = null;
  if (productId) {
    product = await prisma.product.findFirst({ where: { id: productId, organizationId: org }, select: { name: true } });
    if (!product) redirect("/dashboard/flows");
  }

  const connectionId = await ownedConnectionId(org, formData.get("connectionId"));

  const flow = await prisma.flow.create({
    data: {
      organizationId: org,
      name: product ? `${tpl.name} — ${product.name}` : tpl.name,
      productId,
      connectionId,
      isActive: false,
      definition: tpl.definition as Prisma.InputJsonValue,
      fieldSchema: deriveFieldSchema(
        FlowDefinition.parse(tpl.definition),
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/dashboard/products");
  redirect(`/dashboard/flows/${flow.id}/edit`);
}

/** Assign or unassign the product this scenario sells — surfaced on the flow editor header. */
export async function setFlowProductAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const flow = await ownFlow(org, id);
  const productId = String(formData.get("productId") ?? "").trim() || null;
  if (productId) {
    const owned = await prisma.product.findFirst({ where: { id: productId, organizationId: org } });
    if (!owned) return;
  }
  await prisma.flow.update({ where: { id: flow.id }, data: { productId } });
  revalidatePath("/dashboard/flows");
  revalidatePath(`/dashboard/flows/${id}/edit`);
  revalidatePath("/dashboard/products");
}

/**
 * Bind this scenario to one WhatsApp number, or to all of them (empty value).
 * Only affects which number *starts* a run — conversations already in progress
 * keep running their flow, since rebinding mid-conversation would strand a lead
 * halfway through the script.
 */
export async function setFlowConnectionAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const flow = await ownFlow(org, id);
  const connectionId = await ownedConnectionId(org, formData.get("connectionId"));
  await prisma.flow.update({ where: { id: flow.id }, data: { connectionId } });
  revalidatePath("/dashboard/flows");
  revalidatePath(`/dashboard/flows/${id}/edit`);
  revalidatePath("/dashboard/connections");
}
