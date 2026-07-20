"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { he } from "@/lib/he";
import { Sidebar } from "./Sidebar";

/**
 * Navigation drawer for screens below `md`.
 *
 * The sidebar is `hidden md:flex`, which previously left mobile users with no
 * navigation at all — every dashboard page was reachable only by typing a URL.
 * This restores it as a slide-in drawer anchored to the right, matching the RTL
 * layout where the desktop sidebar lives.
 *
 * `footer` is server-rendered content (the logout form, which posts to a server
 * action) passed through as children.
 */
export function MobileNav({
  orgName,
  canManageTeam,
  footer,
}: {
  orgName: string;
  canManageTeam: boolean;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  // Navigating away must close the drawer — otherwise it stays open over the
  // page the user just chose.
  useEffect(() => setOpen(false), [path]);

  // A drawer that cannot be dismissed by Escape is a trap for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Prevent the page behind the overlay from scrolling.
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={he.openMenu}
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-xl text-xl text-slate-600 hover:bg-slate-100"
      >
        ☰
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={he.openMenu}
            className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-2.5">
                <span className="logo-3d grid h-10 w-10 place-items-center rounded-xl text-lg font-black text-white">
                  G
                </span>
                <div>
                  <div className="gradient-text text-base font-black leading-none">{he.appName}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{orgName}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={he.closeMenu}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <Sidebar canManageTeam={canManageTeam} />
            </div>

            <div className="border-t border-line p-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
