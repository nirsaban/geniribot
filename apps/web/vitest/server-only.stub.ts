// `server-only` is a Next.js build-time guard: importing it from a Client
// Component is a compile error. Vitest has no such notion and cannot resolve the
// bare specifier, so tests alias it here. Empty on purpose.
export {};
