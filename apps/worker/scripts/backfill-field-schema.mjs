#!/usr/bin/env node
/**
 * One-off backfill: populate Flow.fieldSchema for flows saved before the column
 * existed.
 *
 *   node apps/worker/scripts/backfill-field-schema.mjs
 *
 * The CRM re-derives the schema at read time when the column is null, so this
 * is an optimisation rather than a correctness fix — it just means the canonical
 * field set is queryable in SQL instead of only computable in the app.
 * Idempotent: re-running only rewrites rows whose derived schema differs.
 */
import { prisma } from "@kesher/db";
import { deriveFieldSchema, FlowDefinition } from "@kesher/flow-engine";

const flows = await prisma.flow.findMany();
let written = 0;
let skipped = 0;

for (const flow of flows) {
  const parsed = FlowDefinition.safeParse(flow.definition);
  if (!parsed.success) {
    console.warn(`skip ${flow.id} (${flow.name}): definition does not parse`);
    skipped += 1;
    continue;
  }
  const derived = deriveFieldSchema(parsed.data);
  if (JSON.stringify(flow.fieldSchema) === JSON.stringify(derived)) {
    skipped += 1;
    continue;
  }
  await prisma.flow.update({ where: { id: flow.id }, data: { fieldSchema: derived } });
  console.log(`${flow.name}: ${derived.map((f) => f.key).join(", ") || "(no fields)"}`);
  written += 1;
}

console.log(`\nbackfilled ${written} flow(s), ${skipped} already current`);
await prisma.$disconnect();
