/**
 * The GeniriBot mark: a chat bubble with a sparkle cut out of it (negative
 * space) — "AI-powered conversation." One shape, `currentColor` fill, so it
 * drops into any of the app's existing gradient frames (the teal `.logo-3d`
 * square used across the dashboard/auth pages, or the landing page's own
 * cyan/sky one) without needing its own color story.
 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.5C6.75 2.5 2.5 6.36 2.5 11.1c0 2.55 1.24 4.84 3.22 6.44l-.94 3.46a.78.78 0 0 0 1 .95l4.1-1.4c.68.14 1.39.21 2.12.21 5.25 0 9.5-3.86 9.5-8.66S17.25 2.5 12 2.5Z
           M12 6.4 13.13 9.47 16.2 10.6 13.13 11.73 12 14.8 10.87 11.73 7.8 10.6 10.87 9.47 Z"
      />
    </svg>
  );
}
