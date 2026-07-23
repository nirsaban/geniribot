import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

/**
 * One-off disaster restore, 2026-07-23.
 *
 * The live DB was accidentally reset by a `prisma migrate diff` whose shadow
 * database URL pointed at the real database. This recreates every organization
 * and user with their ORIGINAL ids (captured from the session that diagnosed
 * the incident), so anything referencing org ids — webhook URLs, bookmarks —
 * keeps working. Passwords could not be recovered (only hashes were stored);
 * all Gmail accounts get the same temporary password and must change it.
 *
 * WhatsApp connections are NOT recreated — Baileys auth state is gone and each
 * tenant must re-pair by scanning the QR from the dashboard.
 */
const prisma = new PrismaClient();

const TEMP_PASSWORD = "Kesher2026!";

const ORGS: Array<{ id: string; name: string; slug: string; plan?: "FREE" | "PRO"; calcomLink?: string }> = [
  { id: "cmrlz25r00000l6d8y7q64dva", name: "Demo Business", slug: "demo" },
  { id: "cmrm2dmto0000l6pob9vu5n8q", name: "GENIRIFLOW", slug: "geniriflow" },
  { id: "cmrm5t5cy0003l6bl3eg1ltw0", name: "GeniriBot Platform", slug: "platform", plan: "PRO" },
  { id: "cmrm9gvzl0000l6jgor15avg8", name: "pasific", slug: "pasific" },
  { id: "cmrma1f5f0000l66tm9lsxr2f", name: "מברוק עליק", slug: "mabruk-alik" },
  { id: "cmrn8hvo50000l6xwzk50gz26", name: "Lama digital", slug: "lama-digital" },
  {
    id: "cmrt7n38f0002l609tjudfior",
    name: "מינדפים מיוחדים",
    slug: "mindafim",
    calcomLink: "https://cal.com/domindaf-zobr08/15min",
  },
];

const USERS: Array<{ email: string; org: string; password?: string; isSuperAdmin?: boolean; name?: string }> = [
  { email: "demo@kesher.local", org: "cmrlz25r00000l6d8y7q64dva", password: "demo1234", name: "Demo Owner" },
  { email: "nirsa11@gmail.com", org: "cmrm2dmto0000l6pob9vu5n8q", name: "Nir" },
  { email: "admin@kesher.local", org: "cmrm5t5cy0003l6bl3eg1ltw0", password: "admin1234", isSuperAdmin: true, name: "Super Admin" },
  { email: "omri@gmail.com", org: "cmrm9gvzl0000l6jgor15avg8" },
  { email: "almog@gmail.com", org: "cmrma1f5f0000l66tm9lsxr2f" },
  { email: "lamadigitalama@gmail.com", org: "cmrn8hvo50000l6xwzk50gz26" },
  { email: "mmhashmal@gmail.com", org: "cmrt7n38f0002l609tjudfior" },
];

/** Standard lead-collection template (same as the web app's "lead" template). */
const LEAD_TEMPLATE = {
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
};

/** מינדפים מיוחדים — reconstructed from the last recorded conversation's messages. */
const MINDAFIM_FLOW = {
  start: "n1",
  trigger: { type: "any" },
  nodes: {
    n1: {
      type: "question",
      field: "resturentType",
      prompt: "מה המצב גבר, איזה מסעדה יש לכם?",
      expect: "text",
      next: "n2",
    },
    n2: { type: "question", field: "exist", prompt: "מעולה. יש לכם מנדף היום?", expect: "text", next: "n3" },
    n3: {
      type: "message",
      text: "אחלה, מתי תהיה זמין לשיחה קצרה?\nשולח לך לינק תבחר מתי נוח לך שאחזור אליך",
      next: "n4",
    },
    n4: { type: "action", action: "book_appointment", next: "n5" },
    n5: { type: "message", text: "תודה רבה! נתראה 🙏", next: null },
  },
};

async function main() {
  for (const o of ORGS) {
    await prisma.organization.upsert({
      where: { id: o.id },
      update: { name: o.name, calcomLink: o.calcomLink ?? null },
      create: {
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan ?? "FREE",
        calcomLink: o.calcomLink ?? null,
        onboardedAt: new Date(),
      },
    });
    console.log(`org restored: ${o.name}`);
  }

  const tempHash = await argon2.hash(TEMP_PASSWORD);
  for (const u of USERS) {
    const passwordHash = u.password ? await argon2.hash(u.password) : tempHash;
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        organizationId: u.org,
        email: u.email,
        name: u.name ?? null,
        role: "OWNER",
        isSuperAdmin: u.isSuperAdmin ?? false,
        passwordHash,
      },
    });
    console.log(`user restored: ${u.email}`);
  }

  await prisma.flow.upsert({
    where: { id: "restored-geniriflow-lead" },
    update: {},
    create: {
      id: "restored-geniriflow-lead",
      organizationId: "cmrm2dmto0000l6pob9vu5n8q",
      name: "איסוף ליד + קביעת פגישה",
      isActive: true,
      definition: LEAD_TEMPLATE,
    },
  });
  await prisma.flow.upsert({
    where: { id: "restored-mindafim-lead" },
    update: {},
    create: {
      id: "restored-mindafim-lead",
      organizationId: "cmrt7n38f0002l609tjudfior",
      name: "איסוף ליד + קביעת פגישה",
      isActive: true,
      definition: MINDAFIM_FLOW,
    },
  });
  console.log("flows restored (GENIRIFLOW + מינדפים מיוחדים)");
  console.log(`\nTemporary password for all Gmail accounts: ${TEMP_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
