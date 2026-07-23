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

  // Auto-activate on save if the org has no active flow yet — so a freshly built
  // bot actually goes live instead of silently sitting inactive.
  const activeElsewhere = await prisma.flow.count({
    where: { organizationId: org, isActive: true, id: { not: flow.id } },
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
  const flow = await prisma.flow.create({
    data: {
      organizationId: org,
      name: tpl.name,
      isActive: false,
      definition: tpl.definition as Prisma.InputJsonValue,
      fieldSchema: deriveFieldSchema(
        FlowDefinition.parse(tpl.definition),
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  redirect(`/dashboard/flows/${flow.id}/edit`);
}
