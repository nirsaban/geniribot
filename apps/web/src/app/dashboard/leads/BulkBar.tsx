"use client";

import { useEffect, useState } from "react";
import { he } from "@/lib/he";

/**
 * Select-all + selected-count for the leads table.
 *
 * The surrounding form and its checkboxes are server-rendered and submit fine
 * without JavaScript; this only adds the conveniences that genuinely need a
 * client — toggling every row at once and showing a live count. When the bulk
 * controls are hidden (nothing selected) the form still works, so a no-JS user
 * simply loses the counter, not the feature.
 */
export function BulkBar({ formId }: { formId: string }) {
  const [count, setCount] = useState(0);

  const boxes = (): HTMLInputElement[] => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return [];
    return [...form.querySelectorAll<HTMLInputElement>('input[name="ids"]')];
  };

  // Rows re-render on every filter/pagination change, so recount from the DOM
  // on any change event rather than trying to track state per row.
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const recount = () => setCount(boxes().filter((b) => b.checked).length);
    form.addEventListener("change", recount);
    recount();
    return () => form.removeEventListener("change", recount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const toggleAll = (checked: boolean) => {
    // Rows render twice (table on desktop, cards on mobile); only the visible
    // copy can be interacted with, but toggling both keeps them consistent.
    for (const b of boxes()) b.checked = checked;
    setCount(checked ? boxes().length / 2 : 0);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line accent-brand"
          onChange={(e) => toggleAll(e.target.checked)}
        />
        {he.selectAll}
      </label>
      {count > 0 && (
        <span className="badge-brand">
          {he.selectedCount}: {count}
        </span>
      )}
    </div>
  );
}
