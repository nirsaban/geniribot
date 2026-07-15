"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FlowDefinition } from "@kesher/flow-engine";
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
export async function saveFlowAction(id: string, definitionJson: string): Promise<{ error?: string }> {
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

  await prisma.flow.update({
    where: { id: flow.id },
    data: { definition: raw as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  revalidatePath("/dashboard/flows");
  revalidatePath(`/dashboard/flows/${id}/edit`);
  return {};
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
        n1: { type: "message", text: "שלום! 👋 אני העוזר של העסק.", next: "n2" },
        n2: { type: "question", field: "name", prompt: "מה השם שלך?", expect: "text", next: "n3" },
        n3: {
          type: "question",
          field: "service",
          prompt: "במה נוכל לעזור?",
          expect: "choice",
          choices: ["מכירה", "תמיכה", "אחר"],
          next: "n4",
        },
        n4: { type: "condition", when: "answers.service == 'מכירה'", then: "n5", else: "n6" },
        n5: { type: "action", action: "book_appointment", next: "n7" },
        n6: { type: "action", action: "notify_agent", next: "n7" },
        n7: { type: "message", text: "תודה! נחזור אליך בהקדם 🙏", next: null },
      },
      _positions: {
        n1: { x: 250, y: 0 },
        n2: { x: 250, y: 110 },
        n3: { x: 250, y: 220 },
        n4: { x: 250, y: 330 },
        n5: { x: 90, y: 440 },
        n6: { x: 410, y: 440 },
        n7: { x: 250, y: 560 },
      },
    },
  },
  support: {
    name: "תמיכה מהירה",
    definition: {
      start: "n1",
      trigger: { type: "keyword", keywords: ["תמיכה", "בעיה", "עזרה"] },
      nodes: {
        n1: { type: "message", text: "שלום! נשמח לעזור 🙌", next: "n2" },
        n2: { type: "question", field: "issue", prompt: "מה הנושא?", expect: "text", next: "n3" },
        n3: { type: "action", action: "notify_agent", next: "n4" },
        n4: { type: "message", text: "קיבלנו! נציג יחזור אליך בהקדם.", next: null },
      },
      _positions: { n1: { x: 250, y: 0 }, n2: { x: 250, y: 110 }, n3: { x: 250, y: 220 }, n4: { x: 250, y: 330 } },
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
    },
  });
  redirect(`/dashboard/flows/${flow.id}/edit`);
}
