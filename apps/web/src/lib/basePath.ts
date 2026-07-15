/**
 * The app's base path (e.g. "/kesher") or "" when served at the domain root.
 * next/link and the router prefix this automatically; raw fetch() and manual
 * redirects do NOT, so use BASE_PATH there.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an internal absolute path with the base path. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
