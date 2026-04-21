#!/usr/bin/env node
/**
 * Minimal PSL sanitiser for measuring contract.json size on real-world
 * Prisma ORM schemas. Strips or rewrites features the prisma-next PSL
 * interpreter does not yet accept, preserving the structural shape
 * (model count, field count, relation graph) so size measurements are
 * representative.
 *
 * Transformations:
 *   - Remove `generator <name> { ... }` blocks (Prisma ORM generators).
 *   - Remove `view <name> { ... }` top-level blocks.
 *   - Strip `@db.XXX(…)?` native-type annotations.
 *   - Strip `@updatedAt` field attribute.
 *   - Replace `Unsupported("…")` field types with `String`.
 *   - Convert `@@id([a, …])` into a field-level `@id` on field `a`
 *     (drops the composite semantic; fine for size measurement).
 *
 * Usage: node preprocess.mjs <input.prisma> <output.prisma>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function sanitise(src) {
  let out = src;

  // Remove generator + datasource blocks.
  out = out.replace(/generator\s+\w+\s*\{[\s\S]*?\n\}/g, '');
  out = out.replace(/datasource\s+\w+\s*\{[\s\S]*?\n\}/g, '');

  // Remove view blocks.
  out = out.replace(/view\s+\w+\s*\{[\s\S]*?\n\}/g, '');

  // Strip `@db.XXX` and `@db.XXX(args)` attributes.
  out = out.replace(/\s*@db\.\w+(\([^)]*\))?/g, '');

  // Strip `@updatedAt`.
  out = out.replace(/\s*@updatedAt/g, '');

  // Replace `Unsupported("…")` with `String`.
  out = out.replace(/Unsupported\("[^"]*"\)/g, 'String');

  // Strip `@@unique(...)` / `@@index(...)` — balanced-paren match to
  // survive multi-line declarations (common in large real schemas).
  // Size impact on contract.json is negligible.
  out = stripBalancedAttr(out, '@@unique');
  out = stripBalancedAttr(out, '@@index');

  // Strip `@@ignore` / `@ignore` — Prisma ORM's "exclude from client"
  // markers. Not meaningful for contract emission.
  out = out.replace(/\s*@@ignore\b/g, '');
  out = out.replace(/\s*@ignore\b/g, '');

  // Strip `map: "…"` arguments wherever they appear. MSSQL-migrated Prisma
  // schemas embed SQL Server constraint names as `map:` args on @default,
  // @id, @@id, @relation, @@unique, @@index, etc. None are needed for
  // contract emission.
  //   `(X, map: "…")` → `(X)`
  //   `(map: "…")`    → removes the whole `(…)`
  //   `, map: "…"`    → `` (trailing map arg inside any attr)
  out = out.replace(/\(\s*map:\s*"[^"]*"\s*\)/g, '');
  out = out.replace(/,\s*map:\s*"[^"]*"/g, '');

  // Strip `onDelete: XXX` and `onUpdate: XXX` within @relation(...).
  // Uses the default for both, which avoids nullable-FK/onDelete-SetNull
  // conflicts.
  out = out.replace(/,\s*onDelete:\s*\w+/g, '');
  out = out.replace(/,\s*onUpdate:\s*\w+/g, '');

  // Convert `@@id([a, …])` → `@id` annotation on field `a` in the same
  // model, and drop the `@@id`. Walk model-by-model to keep scope narrow.
  out = rewriteCompositeIds(out);

  // Ensure every model has at least one `@id` field. If not, inject a
  // synthetic `_pnId Int @id @default(autoincrement())` at the top of
  // the model body.
  out = ensurePrimaryKeys(out);

  return out;
}

/**
 * For every `model Foo { … }` block containing `@@id([a, b, …])`:
 *   1. Drop the `@@id(…)` line.
 *   2. Add `@id` to the first field name listed, if that field exists.
 */
function rewriteCompositeIds(src) {
  return src.replace(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g, (_match, name, body) => {
    // Match @@id with a `[…]` column list; allow trailing args (e.g. `, map: "…"`).
    const compositeIdMatch = body.match(/@@id\(\s*\[([^\]]+)\][^)]*\)/);
    if (!compositeIdMatch) return `model ${name} {${body}\n}`;

    const firstField = compositeIdMatch[1].split(',')[0].trim().replace(/["]/g, '');

    // Drop the `@@id(...)` declaration — balanced-paren strip handles
    // multi-line and nested-arg variants.
    let newBody = stripBalancedAttr(body, '@@id');

    // Only add `@id` if the target field is declared in this model and
    // doesn't already have one.
    const fieldLineRegex = new RegExp(`(^\\s*${firstField}\\s+[^\\n]+)`, 'm');
    newBody = newBody.replace(fieldLineRegex, (line) =>
      /@id(\b|\()/.test(line) ? line : `${line} @id`,
    );

    return `model ${name} {${newBody}\n}`;
  });
}

/**
 * For every `model Foo { … }` block that contains no `@id` annotation,
 * inject a synthetic primary key at the top of the body.
 */
function ensurePrimaryKeys(src) {
  return src.replace(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g, (_match, name, body) => {
    // Check for field-level `@id` — preceded by a non-`@` character so we
    // don't falsely match `@@id` tokens.
    if (/(^|[^@])@id(\b|\()/.test(body)) return `model ${name} {${body}\n}`;
    const synthetic = '\n  _pnId Int @id @default(autoincrement())';
    return `model ${name} {${synthetic}${body}\n}`;
  });
}

/**
 * Strip occurrences of an attribute with balanced parens — works across
 * newlines. `attrName` is the literal prefix, e.g. `@@index`.
 */
function stripBalancedAttr(src, attrName) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf(attrName, i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    // Attribute must start a token — preceded by whitespace/newline.
    const preceding = src[idx - 1];
    if (preceding !== undefined && /\w|@/.test(preceding)) {
      out += src.slice(i, idx + attrName.length);
      i = idx + attrName.length;
      continue;
    }
    const openParen = src.indexOf('(', idx + attrName.length);
    if (openParen === -1) {
      out += src.slice(i);
      break;
    }
    // Scan for the matching close paren, respecting nesting and strings.
    let depth = 1;
    let j = openParen + 1;
    let inString = false;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    // Include any leading whitespace immediately before the attr so we
    // don't leave a dangling space.
    let start = idx;
    while (start > i && /[ \t]/.test(src[start - 1])) start--;
    out += src.slice(i, start);
    i = j;
  }
  return out;
}

/**
 * Erase the line at the given 1-indexed line number (leave it blank).
 * Used to silence lingering field-level errors that survive the
 * structural transforms above.
 */
export function blankLine(src, lineNumber) {
  const lines = src.split('\n');
  if (lineNumber >= 1 && lineNumber <= lines.length) {
    lines[lineNumber - 1] = '';
  }
  return lines.join('\n');
}

export { sanitise };

const runAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runAsScript) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: preprocess.mjs <input.prisma> <output.prisma>');
    process.exit(1);
  }
  const src = readFileSync(input, 'utf8');
  const sanitised = sanitise(src);
  writeFileSync(output, sanitised);
  console.log(`Sanitised ${input} → ${output} (${sanitised.length} bytes)`);
}
