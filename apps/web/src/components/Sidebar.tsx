"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { he } from "@/lib/he";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  /** Hidden from AGENTs. */
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: he.dashboard, icon: "📊", exact: true },
  { href: "/dashboard/connections", label: he.connections, icon: "💬" },
  { href: "/dashboard/flows", label: he.flows, icon: "🧩" },
  { href: "/dashboard/leads", label: he.leads, icon: "👥" },
  { href: "/dashboard/appointments", label: he.appointments, icon: "📅" },
  { href: "/dashboard/team", label: he.team, icon: "🧑‍🤝‍🧑", adminOnly: true },
  { href: "/dashboard/settings", label: he.settings, icon: "⚙️" },
  { href: "/dashboard/billing", label: he.billing, icon: "💳", adminOnly: true },
];

export function Sidebar({ canManageTeam = true }: { orgName?: string; canManageTeam?: boolean }) {
  const path = usePathname();
  const norm = (p: string) => p.replace(/^\/kesher/, "") || "/";
  const cur = norm(path);

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {NAV.filter((item) => canManageTeam || !item.adminOnly).map((item) => {
        const active = item.exact ? cur === item.href : cur.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-brand/10 text-brand-dark"
                : "text-slate-600 hover:bg-slate-100 hover:text-ink"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
