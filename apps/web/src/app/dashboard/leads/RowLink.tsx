"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Makes a whole lead row (or card) navigate to the lead page on click, while
 * leaving real controls — the bulk checkbox, links, buttons — fully usable.
 *
 * A plain <Link> can't wrap a <tr>, and wrapping each cell in links breaks the
 * checkbox column; delegating one click handler on the row is the only shape
 * that gives "click anywhere" without fighting the table markup.
 */
export function RowLink({
  href,
  as: Tag = "tr",
  className,
  children,
}: {
  href: string;
  as?: "tr" | "div";
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    // Let interactive elements keep their own behavior.
    if (t.closest("a,button,input,select,textarea,label")) return;
    router.push(href);
  };
  return (
    <Tag onClick={onClick} className={className} style={{ cursor: "pointer" }}>
      {children}
    </Tag>
  );
}
