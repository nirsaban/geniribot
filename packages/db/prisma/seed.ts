import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

/**
 * Dev seed: one demo organization + owner user + a starter lead-collection flow.
 * Login: demo@kesher.local / demo1234
 */
async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Business", slug: "demo" },
  });

  const passwordHash = await argon2.hash("demo1234");
  await prisma.user.upsert({
    where: { email: "demo@kesher.local" },
    update: {},
    create: {
      organizationId: org.id,
      email: "demo@kesher.local",
      name: "Demo Owner",
      role: "OWNER",
      passwordHash,
    },
  });

  // Platform org + super admin (controls all tenants, billing, plan unlocks).
  const platform = await prisma.organization.upsert({
    where: { slug: "platform" },
    update: {},
    create: { name: "Kesher Platform", slug: "platform", plan: "PRO" },
  });
  await prisma.user.upsert({
    where: { email: "admin@kesher.local" },
    update: { isSuperAdmin: true },
    create: {
      organizationId: platform.id,
      email: "admin@kesher.local",
      name: "Super Admin",
      role: "OWNER",
      isSuperAdmin: true,
      passwordHash: await argon2.hash("admin1234"),
    },
  });

  await prisma.flow.upsert({
    where: { id: "seed-flow" },
    update: {},
    create: {
      id: "seed-flow",
      organizationId: org.id,
      name: "איסוף ליד בסיסי",
      isActive: true,
      definition: {
        start: "n1",
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
          n4: { type: "action", action: "book_appointment", next: "n5" },
          n5: { type: "message", text: "תודה! נחזור אליך בהקדם 🙏", next: null },
        },
      },
    },
  });

  console.log(`Seeded org "${org.name}" (owner: demo@kesher.local / demo1234)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
