import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasRole, type Role } from "@kesher/core";
import { prisma, type ActivityKind } from "@kesher/db";
import type { FieldSpec } from "@kesher/flow-engine";
import { Badge, Card, ServerSelect } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import {
  callbackPhone,
  choiceOptions,
  FIELD_INPUT,
  fieldInputType,
  fieldInputValue,
  isHiddenNumber,
  LEAD_STATUSES,
  leadVisibility,
  schemaOf,
  statusTone,
  suggestionsByField,
} from "@/lib/leads";
import {
  addNoteAction,
  assignOwnerAction,
  deleteNoteAction,
  saveFieldsAction,
  saveSummaryAction,
  setStatusAction,
  setTagAction,
} from "../actions";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(d);
}

const ACTIVITY_ICON: Record<ActivityKind, string> = {
  LEAD_CREATED: "✨",
  STATUS_CHANGED: "🏷️",
  OWNER_ASSIGNED: "👤",
  NOTE_ADDED: "📝",
  SUMMARY_SAVED: "📞",
  TAGS_CHANGED: "🔖",
  FIELDS_UPDATED: "✏️",
  APPOINTMENT_BOOKED: "📅",
  APPOINTMENT_CANCELLED: "🚫",
  CONVERSATION_COMPLETED: "🤖",
  FOLLOW_UP_SENT: "🔥",
};

/**
 * One editable answer.
 *
 * A question the scenario declared with `choices` is a closed menu — those are
 * the only values its routing understands. Everything else stays free text (the
 * lead could type anything on WhatsApp, and so must the agent correcting them)
 * but is backed by a list of what has already been answered, so the common case
 * is picking rather than retyping.
 */
function FieldRow({
  domId,
  fieldKey,
  label,
  spec,
  value,
  options,
}: {
  domId: string;
  fieldKey: string;
  label: string;
  spec?: FieldSpec;
  value: unknown;
  options: string[];
}) {
  const name = FIELD_INPUT + fieldKey;
  // The key is typed free-hand in the bot builder, so it cannot be trusted as a
  // DOM id — `list` has to resolve, and "f:מנדף" would not.
  const listId = `${domId}-opts`;
  const current = fieldInputValue(spec, value);
  const type = fieldInputType(spec, value);
  const suggest = options.filter((o) => o !== current);

  return (
    <div>
      <label className="label" htmlFor={domId}>
        {label}
      </label>
      {spec?.choices?.length ? (
        <ServerSelect id={domId} name={name} value={current} className="input w-full" dir="auto">
          <option value="">{he.fieldNoValue}</option>
          {choiceOptions(spec, value).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </ServerSelect>
      ) : (
        <>
          <input
            id={domId}
            name={name}
            type={type}
            defaultValue={current}
            placeholder={he.fieldNoValue}
            className="input w-full"
            dir={type === "tel" || type === "email" ? "ltr" : "auto"}
            {...(suggest.length > 0 && type !== "date" ? { list: listId } : {})}
          />
          {suggest.length > 0 && type !== "date" && (
            <datalist id={listId}>
              {suggest.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  // Row visibility applies here too: hiding a lead from the list without
  // enforcing it on the detail page would leave it readable by direct URL.
  const visibility = leadVisibility({ userId: session.sub, role: session.role as Role });
  const contact = await prisma.contact.findFirst({
    where: { id, organizationId: session.org, ...(visibility ?? {}) },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      appointments: { orderBy: { startsAt: "asc" } },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { name: true, email: true } } },
      },
    },
  });
  if (!contact) notFound();

  const [members, sourceFlow, summaryAuthor] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: session.org },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    contact.sourceFlowId
      ? prisma.flow.findFirst({
          where: { id: contact.sourceFlowId, organizationId: session.org },
          select: { name: true, definition: true, fieldSchema: true },
        })
      : null,
    contact.callSummaryById
      ? prisma.user.findUnique({
          where: { id: contact.callSummaryById },
          select: { name: true, email: true },
        })
      : null,
  ]);

  const memberName = (m: { name: string | null; email: string }) => m.name || m.email;
  const values = (contact.fields as Record<string, unknown>) ?? {};

  /**
   * Render the scenario's declared fields — every one of them, in order, even
   * when unanswered. A blank "budget" row is information (they dropped off
   * before that question); omitting it entirely is not. Any stray key not in
   * the schema is appended so nothing collected is ever hidden.
   */
  const specs = sourceFlow ? schemaOf(sourceFlow) : [];
  const hidden = isHiddenNumber(contact);
  const given = callbackPhone(contact.fields, specs);
  const known = new Set(specs.map((s) => s.key));
  const extras = Object.keys(values).filter((k) => !known.has(k) && values[k] !== "");

  // What everyone else answered to the same questions, to offer while editing.
  // Scoped to the same scenario: an identical key in another flow is a
  // different question, and its answers would be noise here.
  const peers = await prisma.contact.findMany({
    where: { organizationId: session.org, sourceFlowId: contact.sourceFlowId },
    select: { fields: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const suggestions = suggestionsByField(peers, [...known, ...extras]);

  const messages = contact.conversations.flatMap((c) => c.messages);

  return (
    <>
      <Link href="/dashboard/leads" className="text-sm text-brand">
        {he.backToLeads}
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {contact.name || (hidden ? he.hiddenNumber : contact.phone)}
          </h1>
          {hidden ? (
            <div className="mt-1">
              {given ? (
                <p className="text-sm text-slate-500">
                  {he.callbackPhoneLabel}:{" "}
                  <span dir="ltr" className="font-medium text-ink">
                    {given}
                  </span>
                </p>
              ) : (
                <p className="max-w-prose text-xs text-slate-400">🔒 {he.hiddenNumberHint}</p>
              )}
              {/* The LID still identifies the chat, so keep it available for
                  support — just not labelled as a phone number. */}
              <p className="mt-1 text-[11px] text-slate-300" dir="ltr">
                {he.waIdLabel}: {contact.phone}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500" dir="ltr">
              {contact.phone}
            </p>
          )}
        </div>
        <Badge tone={statusTone(contact.status)}>{he.leadStatus[contact.status]}</Badge>
      </div>

      {/* Pipeline controls — the two things an agent changes most often. */}
      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={setStatusAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={contact.id} />
            <div className="flex-1">
              <label className="label" htmlFor="status">
                {he.changeStatus}
              </label>
              <ServerSelect id="status" name="status" value={contact.status} className="input">
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {he.leadStatus[s]}
                  </option>
                ))}
              </ServerSelect>
            </div>
            <button className="btn-secondary btn-sm" type="submit">
              {he.bulkApply}
            </button>
          </form>

          <form action={assignOwnerAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={contact.id} />
            <div className="flex-1">
              <label className="label" htmlFor="ownerUserId">
                {he.assignOwner}
              </label>
              <ServerSelect
                id="ownerUserId"
                name="ownerUserId"
                value={contact.ownerUserId ?? ""}
                className="input"
              >
                <option value="">{he.unassigned}</option>
                {/* Agents may claim or release, not reassign to a colleague. */}
                {(hasRole(session.role as Role, "ADMIN")
                  ? members
                  : members.filter((m) => m.id === session.sub)
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberName(m)}
                  </option>
                ))}
              </ServerSelect>
            </div>
            <button className="btn-secondary btn-sm" type="submit">
              {he.bulkApply}
            </button>
          </form>
        </div>
      </Card>

      {/* Post-call summary — typed by the agent after the sales call. */}
      <Card className="mb-5">
        <h2 className="font-semibold text-ink">{he.callSummaryTitle}</h2>
        <p className="mb-3 mt-1 text-xs text-slate-400">{he.callSummaryHint}</p>
        <form action={saveSummaryAction}>
          <input type="hidden" name="id" value={contact.id} />
          <textarea
            name="callSummary"
            rows={4}
            defaultValue={contact.callSummary ?? ""}
            placeholder={he.callSummaryPlaceholder}
            className="input w-full resize-y"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              {contact.callSummaryAt
                ? `${he.callSummaryBy} ${summaryAuthor ? memberName(summaryAuthor) : "—"} · ${fmt(contact.callSummaryAt)}`
                : he.callSummaryEmpty}
            </span>
            <button className="btn-primary btn-sm" type="submit">
              {he.callSummarySave}
            </button>
          </div>
        </form>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Collected fields, rendered from the scenario's schema. */}
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{he.collectedFields}</h2>
          {sourceFlow && (
            <p className="mb-3 text-xs text-slate-400">
              <span className="badge-brand">⚡ {sourceFlow.name}</span>
            </p>
          )}
          {specs.length === 0 && extras.length === 0 ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            /* Editable, because the bot records whatever the lead typed and an
               agent needs to fix a mistyped answer without a developer. Choice
               questions are a menu of the options the scenario declared, so an
               edit cannot invent a value the flow's routing does not know. */
            <form action={saveFieldsAction} className="space-y-3 text-sm">
              <input type="hidden" name="id" value={contact.id} />
              {specs.map((spec, i) => (
                <FieldRow
                  key={spec.key}
                  domId={`lf${i}`}
                  fieldKey={spec.key}
                  label={spec.label}
                  spec={spec}
                  value={values[spec.key]}
                  options={suggestions.get(spec.key) ?? []}
                />
              ))}
              {/* Answers the scenario no longer declares — still the lead's data. */}
              {extras.map((k, i) => (
                <FieldRow
                  key={k}
                  domId={`lx${i}`}
                  fieldKey={k}
                  label={k}
                  value={values[k]}
                  options={suggestions.get(k) ?? []}
                />
              ))}
              <div className="flex justify-end">
                <button className="btn-secondary btn-sm" type="submit">
                  {he.saveFields}
                </button>
              </div>
            </form>
          )}
          <div className="mt-5 border-t border-line/60 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">{he.tagsTitle}</h3>
            {contact.tags.length === 0 ? (
              <p className="text-sm text-slate-400">{he.noTags}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t) => (
                  <form key={t} action={setTagAction} className="inline-flex">
                    <input type="hidden" name="id" value={contact.id} />
                    <input type="hidden" name="tag" value={t} />
                    <input type="hidden" name="op" value="remove" />
                    <button
                      type="submit"
                      title={he.removeTag}
                      className="badge-gray hover:bg-red-50 hover:text-red-600"
                    >
                      {t} <span aria-hidden="true">✕</span>
                    </button>
                  </form>
                ))}
              </div>
            )}
            <form action={setTagAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={contact.id} />
              <input
                name="tag"
                required
                placeholder={he.tagPlaceholder}
                className="input min-w-0 flex-1"
              />
              <button className="btn-secondary btn-sm" type="submit">
                {he.addTag}
              </button>
            </form>
          </div>
        </Card>

        {/* Appointments */}
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{he.appointmentsTitle}</h2>
          {contact.appointments.length === 0 ? (
            <p className="text-sm text-slate-400">{he.noAppointments}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {contact.appointments.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>{fmt(a.startsAt)}</span>
                  <span className="text-slate-400">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Notes */}
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{he.notesTitle}</h2>
          <form action={addNoteAction} className="mb-4">
            <input type="hidden" name="id" value={contact.id} />
            <textarea
              name="body"
              rows={2}
              required
              placeholder={he.notePlaceholder}
              className="input w-full resize-y"
            />
            <button className="btn-secondary btn-sm mt-2" type="submit">
              {he.addNote}
            </button>
          </form>
          {contact.notes.length === 0 ? (
            <p className="text-sm text-slate-400">{he.noNotes}</p>
          ) : (
            <ul className="space-y-3">
              {contact.notes.map((n) => (
                <li key={n.id} className="border-b border-line/60 pb-3 last:border-0 last:pb-0">
                  <p className="whitespace-pre-wrap text-sm text-ink" dir="auto">
                    {n.body}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {n.author ? memberName(n.author) : he.byBot} · {fmt(n.createdAt)}
                    </span>
                    {(n.userId === session.sub || session.role !== "AGENT") && (
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="noteId" value={n.id} />
                        <button className="text-slate-400 hover:text-red-500" type="submit">
                          {he.deleteNote}
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Activity timeline */}
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{he.timelineTitle}</h2>
          {contact.activities.length === 0 ? (
            <p className="text-sm text-slate-400">{he.noActivity}</p>
          ) : (
            <ul className="space-y-3">
              {contact.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="shrink-0 text-base leading-5">{ACTIVITY_ICON[a.kind]}</span>
                  <div className="min-w-0">
                    <div className="text-ink">
                      {he.activityKind[a.kind]}
                      {a.kind === "FIELDS_UPDATED" && a.toValue && (
                        <span className="text-slate-500"> · {a.toValue}</span>
                      )}
                      {a.kind === "STATUS_CHANGED" && a.toValue && (
                        <span className="text-slate-500">
                          {" "}
                          → {he.leadStatus[a.toValue as keyof typeof he.leadStatus] ?? a.toValue}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {a.actor ? memberName(a.actor) : he.byBot} · {fmt(a.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Conversation transcript */}
      <Card className="mt-5">
        <h2 className="mb-4 font-semibold text-ink">{he.transcript}</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">{he.noMessages}</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => {
              const inbound = m.direction === "IN";
              return (
                <div key={m.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[75%] ${
                      inbound ? "bg-slate-100 text-slate-800" : "bg-brand text-white"
                    }`}
                  >
                    <div className="mb-0.5 text-[10px] opacity-60">
                      {inbound ? he.msgIn : he.msgOut} · {fmt(m.createdAt)}
                    </div>
                    <span className="whitespace-pre-wrap" dir="auto">
                      {m.body}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
