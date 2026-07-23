"use client";

import { useState, useTransition } from "react";
import { he } from "@/lib/he";
import { deleteFlowAction, renameFlowAction } from "./actions";

/**
 * Rename + permanent delete controls for one flow card.
 *
 * Client component because both need a beat of interactivity a server form
 * can't give: rename toggles an inline input, delete demands an explicit
 * confirm before an irreversible action.
 */
export function FlowCardActions({ id, name }: { id: string; name: string }) {
  const [renaming, setRenaming] = useState(false);
  const [pending, start] = useTransition();

  if (renaming) {
    return (
      <form
        className="flex items-center gap-2"
        action={(fd) => {
          start(async () => {
            await renameFlowAction(fd);
            setRenaming(false);
          });
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input
          name="name"
          defaultValue={name}
          autoFocus
          aria-label={he.flowNameLabel}
          className="input btn-sm max-w-[14rem]"
        />
        <button className="btn-primary btn-sm" disabled={pending} type="submit">
          {he.saveName}
        </button>
        <button className="btn-ghost btn-sm" type="button" onClick={() => setRenaming(false)}>
          {he.cancel}
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary btn-sm" type="button" onClick={() => setRenaming(true)}>
        ✏️ {he.renameFlow}
      </button>
      <form
        action={(fd) => {
          if (!window.confirm(he.deleteFlowConfirm)) return;
          start(async () => {
            await deleteFlowAction(fd);
          });
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="btn-danger btn-sm" disabled={pending} type="submit">
          🗑 {he.deleteFlow}
        </button>
      </form>
    </div>
  );
}
