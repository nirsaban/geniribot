# WhatsApp Cloud API — Embedded Signup Onboarding (Plan)

Goal: let a GeniriBot tenant connect an **official** WhatsApp number with **one click**
("Connect with Facebook"), instead of manually pasting a phone-number-id + access token.
Meta's Embedded Signup runs the whole thing — it creates/attaches the WhatsApp Business
Account (WABA), the phone number, accepts the ToS, and hands us back the IDs + a token we
exchange server-side. This replaces the current manual `createCloudConnectionAction` paste form.

Status today (Phase 8): we already have `CloudApiProvider` (send), `parseCloudWebhook`, a
public webhook at `apps/web/src/app/api/webhooks/whatsapp/route.ts`, and cloud connections
stored in `WhatsAppConnection.authState = {phoneNumberId, verifyToken, accessTokenEnc}`.
Embedded Signup swaps the *acquisition* step (paste → button); the send/receive plumbing is unchanged.

---

## 0. Meta-side prerequisites (business setup — do this FIRST, it gates everything)

These are **one-time, platform-operator** steps (you, not the tenant). Some take days.

1. **Meta App** (type *Business*) at developers.facebook.com → note **App ID** + **App Secret**.
2. Add products to the app: **WhatsApp** + **Facebook Login for Business**.
3. **Become a Tech Provider**: complete **Business Verification**, then request **Advanced Access**
   to `whatsapp_business_management` and `whatsapp_business_messaging` (App Review). Until approved,
   Embedded Signup only works for numbers on *your own* dev account (dev mode) — fine for testing,
   not for real tenants.
4. Create an **Embedded Signup configuration** → gives a **`config_id`** (this pins which
   permissions/features the popup requests: WhatsApp Cloud API).
5. **App-level webhook**: set the callback URL to our public webhook and set ONE app-level
   **verify token** + subscribe to the `messages` field on the *WhatsApp Business Account* object.
   (Per-customer, we then call `/{waba_id}/subscribed_apps` — step 3.3 below.)
6. Have a **System User token** (or use App-access `APP_ID|APP_SECRET`) for server-side calls.

New env vars (add to `.env` / `.env.example`, and the platform admin screen):
```
META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=            # Embedded Signup configuration id
META_WEBHOOK_VERIFY_TOKEN= # single app-level verify token
META_GRAPH_VERSION=v21.0
META_SYSTEM_USER_TOKEN=    # optional; else use APP_ID|APP_SECRET as app access token
```
Decision: these can live as **platform-org Secrets** (like Grow keys already do) instead of env,
so the super-admin pastes them in `/admin`. Recommended, matches Phase 9 pattern.

---

## 1. Client flow (dashboard button)

New client component `apps/web/src/app/dashboard/connections/EmbeddedSignupButton.tsx`:

1. Inject the **Facebook JS SDK** once (`connect.facebook.net/en_US/sdk.js`) and `FB.init({ appId: META_APP_ID, version: META_GRAPH_VERSION })`. `META_APP_ID` is exposed as a `NEXT_PUBLIC_` var (public by design).
2. Register a `window.addEventListener('message', …)` listener for origin `facebook.com`,
   `event.data.type === 'WA_EMBEDDED_SIGNUP'` → capture **`phone_number_id`** and **`waba_id`**
   from `event.data.data`.
3. On button click call:
   ```js
   FB.login(cb, {
     config_id: META_CONFIG_ID,
     response_type: 'code',
     override_default_response_type: true,
     extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
   });
   ```
4. In the `FB.login` callback, read **`response.authResponse.code`** (the exchangeable code).
5. `POST /api/whatsapp/embedded-signup` with `{ code, phone_number_id, waba_id, label }`.
   Then refresh the connections list (the server creates the connection).

Handle the cancel/close case (`response.status !== 'connected'` or no `code`) → show a friendly
"onboarding not completed" message, create nothing.

---

## 2. Server flow (new API route, org-guarded)

New route `apps/web/src/app/api/whatsapp/embedded-signup/route.ts` (session-guarded, tenant = session.org).
Enforce `atConnectionLimit(org)` **before** creating — reuse the exact check from `connections/actions.ts`
so multi-number stays plan-gated (this is why nirsa11 needed PRO).

Steps, using new helpers in `packages/whatsapp/src/embedded-signup.ts` (pure, fetch-injectable, unit-tested):

1. **Exchange code → business token**
   `GET /{v}/oauth/access_token?client_id=META_APP_ID&client_secret=META_APP_SECRET&code=CODE`
   → `{ access_token }` (this is the customer's long-lived business token).
2. **Register the phone number** for Cloud API
   `POST /{v}/{phone_number_id}/register` body `{ messaging_product:'whatsapp', pin:'<6-digit>' }`
   (set/record a 2FA PIN; store it so we can re-register). Idempotent-ish: if already registered,
   Meta returns an error we can treat as success.
3. **Subscribe our app to the WABA** so webhooks flow
   `POST /{v}/{waba_id}/subscribed_apps` (Bearer business token).
4. (Optional) fetch the display phone number `GET /{v}/{phone_number_id}?fields=display_phone_number`
   to store a human-readable number on the connection.
5. **Persist** as a `cloud_api` connection:
   ```ts
   authState = { kind:'cloud_api', wabaId, phoneNumberId, accessTokenEnc: encField(businessToken) }
   // verifyToken no longer per-connection — webhook now uses the app-level token (see §4)
   ```
   `status: 'CONNECTED'`, `phoneNumber: display_phone_number ?? phone_number_id`,
   `defaultFlowId: activeFlowId(org)`. Then `gatewayConnect(conn.id, org)` (no-op for cloud, keeps parity).

Everything downstream (send via `CloudApiProvider`, inbound via `parseCloudWebhook`) already works.

---

## 3. Schema changes

Migration `embedded_signup`:
- `WhatsAppConnection.wabaId String?` — dedicated column (still mirrored in `authState` for the provider loader). Useful for admin/debug and for `subscribed_apps` re-subscribe.
- (optional) `WhatsAppConnection.displayPhoneNumber String?` if we want it separate from `phoneNumber`.

No enum changes — `provider="cloud_api"` and `status` reuse existing values.

---

## 4. Webhook changes (important)

Embedded Signup uses **ONE app-level webhook + ONE verify token** (not per-connection like today).

- `route.ts` **GET**: compare `hub.verify_token` against **`META_WEBHOOK_VERIFY_TOKEN`** (env/secret),
  not against each connection's `verifyToken`. (Keep the old per-connection check as a fallback so
  manually-added connections from Phase 8 still verify.)
- `route.ts` **POST**: add **signature verification** — validate `X-Hub-Signature-256` = HMAC-SHA256 of
  the raw body with `META_APP_SECRET`. This is a currently-open gap (see ROADMAP "Meta webhook signature
  verify") and Embedded Signup is the right time to close it. Reject on mismatch.
- Routing by `phone_number_id` is unchanged (already implemented).

---

## 5. Onboarding wizard integration

`OnboardingWizard.tsx` WhatsApp step becomes a two-option chooser:
- **מומלץ · חיבור רשמי (Official, one-click)** → the `EmbeddedSignupButton` (Cloud API). Best deliverability, no ban risk, needed for scale.
- **מהיר · QR (לא רשמי)** → existing Baileys QR flow (kept for quick trials).

Connections page (`connections/page.tsx`): make the Cloud card's primary CTA the **"התחברות עם פייסבוק"**
button; demote the manual paste form to a collapsible "מתקדם / הזנה ידנית" (keep for BYO-token users).

Copy strings go in `apps/web/src/lib/he.ts` (existing convention).

---

## 6. Multi-connection packaging (part 2 — DONE for nirsa11)

Already applied: **GENIRIFLOW (nirsa11@gmail.com) → PRO** (10 connections). Plan catalog
(`packages/billing/src/plans.ts`): FREE=1, STARTER=2, PRO=10 connections — enforcement lives in
`atConnectionLimit()` and is reused by the new embedded-signup route.

If you want a truly unlimited tier for resellers, add an `ENTERPRISE` plan (connections: 999) +
super-admin manual assignment (the `/admin` `setOrgPlanAction` already exists). Optional, not required.

---

## 7. Files touched (summary)

New:
- `packages/whatsapp/src/embedded-signup.ts` (+ test) — exchangeCode / registerPhoneNumber / subscribeApp / getDisplayNumber
- `apps/web/src/app/api/whatsapp/embedded-signup/route.ts` — orchestrates + persists
- `apps/web/src/app/dashboard/connections/EmbeddedSignupButton.tsx` — FB SDK + FB.login

Changed:
- `apps/web/src/app/api/webhooks/whatsapp/route.ts` — app-level verify token + X-Hub-Signature-256
- `apps/web/src/app/dashboard/connections/page.tsx` — button primary, manual form demoted
- `apps/web/src/app/dashboard/onboarding/OnboardingWizard.tsx` — official vs QR chooser
- `packages/db/prisma/schema.prisma` (+ migration) — wabaId
- `apps/web/src/lib/he.ts` — copy
- `.env.example`, platform-admin secrets — META_* config

## 8. Test / verify plan

- Unit: mock `fetch` for the 3 Graph calls; assert URLs, bodies, Bearer headers, error handling.
- Webhook: GET verify with app-level token → challenge; wrong token → 403; POST with valid signature → 200; bad signature → 401.
- E2E (dev mode, our own dev number): click button in a test tab → popup → complete → connection row appears CONNECTED → send a message from the number → bot replies (reuses the verified Phase 8 inbound loop).
- Plan gate: as a FREE org, the 2nd embedded-signup attempt redirects to `/dashboard/billing?limit=connections`.

## 9. Sequencing (suggested)

1. Meta app + Tech Provider verification kicked off (long lead time — start now).
2. `embedded-signup.ts` helpers + tests (no Meta account needed — mocked).
3. API route + schema migration + plan-gate.
4. Webhook app-level token + signature verify.
5. Client button + connections/onboarding UI.
6. Dev-mode E2E once App Review / dev number is ready.
