import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Adds a few sample leads + conversations to the demo org so the CRM dashboard
 * is populated before a real WhatsApp number is paired. Idempotent-ish (keyed
 * by phone). Run: pnpm --filter @kesher/db exec tsx prisma/demo-leads.ts
 */
async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: "demo" } });
  if (!org) throw new Error("demo org not found — run the main seed first");
  const conn = await prisma.whatsAppConnection.findFirst({ where: { organizationId: org.id } });
  const connectionId = conn?.id ?? "demo-connection";

  // Availability: Sun–Thu, 09:00–17:00 Israel time, 30-min slots.
  // (Phase-0 scheduling is UTC-only; 06:00–14:00 UTC ≈ 09:00–17:00 in summer IL.
  //  Proper per-tenant timezone handling lands in Phase 5.)
  await prisma.availabilityRule.deleteMany({ where: { organizationId: org.id } });
  for (const weekday of [0, 1, 2, 3, 4]) {
    await prisma.availabilityRule.create({
      data: {
        organizationId: org.id,
        weekday,
        startMinute: 6 * 60,
        endMinute: 14 * 60,
        slotMinutes: 30,
        timezone: "Asia/Jerusalem",
      },
    });
  }

  const samples = [
    {
      phone: "972501112233",
      name: "דנה כהן",
      fields: { name: "דנה כהן", service: "מכירה", budget: "5000" },
      tags: ["מכירה", "חם"],
      transcript: [
        ["IN", "היי, ראיתי את המודעה"],
        ["OUT", "שלום דנה! 👋 אני העוזר של העסק. במה נוכל לעזור?"],
        ["IN", "מעוניינת בשירות מכירה"],
        ["OUT", "מעולה! אשמח לקבוע לך שיחה עם נציג. מתי נוח?"],
      ],
      appt: true,
    },
    {
      phone: "972529998877",
      name: "יוסי לוי",
      fields: { name: "יוסי לוי", service: "תמיכה" },
      tags: ["תמיכה"],
      transcript: [
        ["IN", "יש לי בעיה עם ההזמנה"],
        ["OUT", "שלום יוסי, נציג יחזור אליך בהקדם 🙏"],
      ],
      appt: false,
    },
    {
      phone: "972546665544",
      name: "מאיה ברק",
      fields: { name: "מאיה ברק", service: "מכירה", budget: "12000" },
      tags: ["מכירה"],
      transcript: [
        ["IN", "שלום"],
        ["OUT", "שלום מאיה! 👋 במה נוכל לעזור?"],
        ["IN", "רוצה הצעת מחיר"],
      ],
      appt: false,
    },
  ] as const;

  for (const s of samples) {
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId: org.id, phone: s.phone } },
      update: { name: s.name, fields: s.fields, tags: [...s.tags] },
      create: {
        organizationId: org.id,
        phone: s.phone,
        name: s.name,
        fields: s.fields,
        tags: [...s.tags],
      },
    });

    // fresh conversation each run (delete old demo ones for this contact)
    await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
    const convo = await prisma.conversation.create({
      data: {
        organizationId: org.id,
        contactId: contact.id,
        connectionId,
        status: s.appt ? "COMPLETED" : "ACTIVE",
      },
    });
    for (const [dir, body] of s.transcript) {
      await prisma.message.create({
        data: { conversationId: convo.id, direction: dir as "IN" | "OUT", body },
      });
    }

    if (s.appt) {
      const start = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      start.setUTCHours(9, 0, 0, 0);
      await prisma.appointment.deleteMany({ where: { contactId: contact.id } });
      await prisma.appointment.create({
        data: {
          organizationId: org.id,
          contactId: contact.id,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60 * 1000),
          status: "BOOKED",
        },
      });
    }
  }

  console.log(`Seeded ${samples.length} demo leads for org "${org.name}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
