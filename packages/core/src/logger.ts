import pino from "pino";

/** Shared structured logger. Create child loggers per service/module. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: undefined,
});

export function childLogger(name: string) {
  return logger.child({ service: name });
}
