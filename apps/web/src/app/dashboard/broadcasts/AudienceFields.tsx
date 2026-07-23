import { he } from "@/lib/he";
import { LEAD_STATUSES } from "@/lib/leads";

/**
 * The recipient-picking half of a broadcast/group form: CRM leads (with
 * status/tag filter), manual numbers, CSV upload. Server-rendered; the parsing
 * lives in `lib/audience.ts` so both features resolve audiences identically.
 */
export function AudienceFields({ tags }: { tags: string[] }) {
  return (
    <fieldset className="space-y-3">
      <legend className="label">{he.broadcastAudience}</legend>

      <div className="rounded-xl border border-line p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="includeLeads"
            value="1"
            className="h-4 w-4 rounded border-line accent-brand"
          />
          {he.broadcastAudienceLeads}
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select name="leadStatus" defaultValue="" className="input" aria-label={he.filterStatus}>
            <option value="">{he.broadcastAudienceLeadsAll}</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {he.leadStatus[s]}
              </option>
            ))}
          </select>
          <select name="leadTag" defaultValue="" className="input" aria-label={he.filterTag}>
            <option value="">{he.anyValue}</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="manualPhones">
          {he.broadcastAudienceManual}
        </label>
        <textarea
          id="manualPhones"
          name="manualPhones"
          rows={2}
          dir="ltr"
          placeholder="0501234567, 972521234567"
          className="input w-full text-left"
        />
      </div>

      <div>
        <label className="label" htmlFor="csv">
          {he.broadcastAudienceCsv}
        </label>
        <input id="csv" type="file" name="csv" accept=".csv,text/csv,text/plain" className="input" />
        <p className="mt-1 text-xs text-slate-400">{he.broadcastCsvHint}</p>
      </div>
    </fieldset>
  );
}
