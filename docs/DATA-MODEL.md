# Data model (Prisma draft)

Every domain table carries `organizationId` for tenant isolation. IDs are cuid/uuid.
This is a **draft to react to**, not final — it covers the MVP surface.

```prisma
// ---------- Tenancy & auth ----------
model Organization {
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique
  plan          Plan     @default(FREE)
  createdAt     DateTime @default(now())

  users         User[]
  connections   WhatsAppConnection[]
  flows         Flow[]
  contacts      Contact[]
  conversations Conversation[]
  appointments  Appointment[]
  availability  AvailabilityRule[]
  calendarLinks CalendarIntegration[]
}

model User {
  id             String   @id @default(cuid())
  organizationId String
  email          String   @unique
  passwordHash   String
  name           String?
  role           Role     @default(AGENT)
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
}

enum Role { OWNER ADMIN AGENT }
enum Plan { FREE STARTER PRO }

// ---------- WhatsApp ----------
model WhatsAppConnection {
  id             String   @id @default(cuid())
  organizationId String
  label          String                       // "Sales line"
  phoneNumber    String?                       // filled once paired
  provider       String   @default("baileys")  // baileys | cloud_api
  status         WaStatus @default(PENDING)     // PENDING|QR|CONNECTED|DISCONNECTED|LOGGED_OUT
  authState      Json?                          // encrypted Baileys creds/keys
  defaultFlowId  String?                        // flow that greets new inbound leads
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}

enum WaStatus { PENDING QR CONNECTED DISCONNECTED LOGGED_OUT }

// ---------- Flows (bot definitions) ----------
model Flow {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  version        Int      @default(1)
  isActive       Boolean  @default(false)
  definition     Json                          // node graph (see flow-engine)
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}

// ---------- Contacts / leads ----------
model Contact {
  id             String   @id @default(cuid())
  organizationId String
  phone          String
  name           String?
  fields         Json     @default("{}")        // collected answers, keyed by flow field name
  tags           String[] @default([])
  ownerUserId    String?                         // assigned agent
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  conversations  Conversation[]
  appointments   Appointment[]
  @@unique([organizationId, phone])
  @@index([organizationId])
}

// ---------- Conversations (flow-run state) ----------
model Conversation {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  connectionId   String
  flowId         String?
  currentNodeId  String?
  state          Json     @default("{}")         // engine state: answers-so-far, retries
  status         ConvoStatus @default(ACTIVE)     // ACTIVE|COMPLETED|HANDOFF|ABANDONED
  lastMessageAt  DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  contact        Contact      @relation(fields: [contactId], references: [id])
  messages       Message[]
  @@index([organizationId])
  @@index([contactId])
}

enum ConvoStatus { ACTIVE COMPLETED HANDOFF ABANDONED }

model Message {
  id             String   @id @default(cuid())
  conversationId String
  direction      Direction                       // IN | OUT
  body           String
  raw            Json?                            // provider payload
  createdAt      DateTime @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  @@index([conversationId])
}

enum Direction { IN OUT }

// ---------- Scheduling ----------
model AvailabilityRule {
  id             String   @id @default(cuid())
  organizationId String
  userId         String?                          // per-agent, or org-wide if null
  weekday        Int                               // 0-6
  startMinute    Int                               // minutes from midnight, local tz
  endMinute      Int
  slotMinutes    Int      @default(30)
  bufferMinutes  Int      @default(0)
  timezone       String   @default("Asia/Jerusalem")
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}

model Appointment {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  userId         String?                          // assigned agent
  startsAt       DateTime
  endsAt         DateTime
  status         ApptStatus @default(BOOKED)       // BOOKED|CONFIRMED|CANCELLED|COMPLETED|NO_SHOW
  googleEventId  String?
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  contact        Contact      @relation(fields: [contactId], references: [id])
  @@index([organizationId])
  @@index([startsAt])
}

enum ApptStatus { BOOKED CONFIRMED CANCELLED COMPLETED NO_SHOW }

model CalendarIntegration {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  provider       String   @default("google")
  accessToken    String                           // encrypted
  refreshToken   String                           // encrypted
  calendarId     String?
  expiresAt      DateTime?
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}
```

## Flow definition shape (stored in `Flow.definition`)

```jsonc
{
  "start": "n1",
  "nodes": {
    "n1": { "type": "message",  "text": "שלום! 👋 אני העוזר של העסק.", "next": "n2" },
    "n2": { "type": "question", "field": "name",   "prompt": "מה השם שלך?", "expect": "text",  "next": "n3" },
    "n3": { "type": "question", "field": "service","prompt": "במה נוכל לעזור?", "expect": "choice",
            "choices": ["מכירה", "תמיכה", "אחר"], "next": "n4" },
    "n4": { "type": "condition","when": "answers.service == 'מכירה'", "then": "n5", "else": "n6" },
    "n5": { "type": "action",   "action": "book_appointment", "next": "n7" },
    "n6": { "type": "action",   "action": "notify_agent", "next": "n7" },
    "n7": { "type": "message",  "text": "תודה! נחזור אליך בהקדם 🙏", "next": null }
  }
}
```

Notes: content is Hebrew/RTL-friendly (the user's audience is Israeli). Consider a `he.ts`-style
string dictionary for platform UI copy, matching the convention already used in the Kursim app.
