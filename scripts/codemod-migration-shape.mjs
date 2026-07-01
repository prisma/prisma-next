#!/usr/bin/env node
/**
 * One-shot codemod: convert a committed example `migration.ts` from the old
 * hand-written `describe()` scaffold to the new contract-JSON scaffold that the
 * migration generator (`renderCallsToTypeScript`, TML-2892) now emits.
 *
 * The transform is source-to-source and behavior-preserving:
 *   - The `operations` getter body is kept verbatim (so `ops.json` is
 *     byte-identical after the migration re-emits).
 *   - `describe()` is removed; its `from`/`to` only decide the baseline shape.
 *     The base derives describe() from the imported contract JSON, whose
 *     `storage.storageHash` already equals the committed from/to hashes.
 *   - Contract-JSON imports + `endContractJson` / `startContractJson` fields are
 *     injected; the class header gets `<Start, End>` (or `<never, End>` baseline).
 *
 * Idempotent: a migration already on the new shape (`endContractJson` field, no
 * `describe()`) is left untouched.
 *
 * Final formatting is NOT done here — the caller runs `biome check --write` so
 * the output matches the generator's biome-formatted shape exactly.
 *
 * Usage: node scripts/codemod-migration-shape.mjs <migration.ts> [<migration.ts> ...]
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** Extract the `from:`/`to:` from a `describe()` return literal. */
function parseDescribe(src) {
  // Match `override describe() { return { from: <x>, to: <y> ... }; }`
  const fromMatch = src.match(/\bfrom:\s*(null|['"]sha256:[0-9a-f]+['"])/);
  const toMatch = src.match(/\bto:\s*['"](sha256:[0-9a-f]+)['"]/);
  if (!toMatch) {
    throw new Error('codemod: no `to: "sha256:..."` found in describe()');
  }
  const isBaseline = !fromMatch || fromMatch[1] === 'null';
  return { isBaseline };
}

/** Remove the whole `override describe() { ... }` method (brace-balanced). */
function stripDescribe(src) {
  const start = src.search(/\n[ \t]*override describe\(\)\s*\{/);
  if (start === -1) return src;
  // find the method's opening brace, then balance.
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  // i is at the closing brace of the method. Drop from `start` (the leading
  // newline) through the closing brace and any trailing blank line.
  let end = i + 1;
  if (src.slice(end).startsWith('\n\n')) end += 1; // collapse one blank line
  return src.slice(0, start) + src.slice(end);
}

function transform(path) {
  let src = readFileSync(path, 'utf8');

  if (src.includes('endContractJson =') && !/\boverride describe\(\)/.test(src)) {
    return { path, changed: false, reason: 'already new shape' };
  }
  if (!/\boverride describe\(\)/.test(src)) {
    return { path, changed: false, reason: 'no describe() to convert (skipped)' };
  }

  const { isBaseline } = parseDescribe(src);

  // 1. Strip describe().
  src = stripDescribe(src);

  // 2. Inject contract-JSON imports after the shebang (biome re-sorts later).
  const contractImports = [
    `import type { Contract as End } from './end-contract';`,
    `import endContract from './end-contract.json' with { type: 'json' };`,
    ...(isBaseline
      ? []
      : [
          `import type { Contract as Start } from './start-contract';`,
          `import startContract from './start-contract.json' with { type: 'json' };`,
        ]),
  ].join('\n');

  const shebang = '#!/usr/bin/env -S node\n';
  if (src.startsWith(shebang)) {
    src = shebang + contractImports + '\n' + src.slice(shebang.length);
  } else {
    src = contractImports + '\n' + src;
  }

  // 3. Add the `<Start, End>` / `<never, End>` generic to the class header and
  //    inject the field(s) right after the opening brace.
  const generics = isBaseline ? '<never, End>' : '<Start, End>';
  const fields = isBaseline
    ? '  override readonly endContractJson = endContract;\n\n'
    : '  override readonly startContractJson = startContract;\n  override readonly endContractJson = endContract;\n\n';

  const classRe = /((?:export default )?class \w+ extends Migration)(\s*\{)/;
  if (!classRe.test(src)) {
    throw new Error('codemod: no `class … extends Migration {` header found');
  }
  src = src.replace(
    classRe,
    (_m, head, brace) => `${head}${generics}${brace.replace(/\s*\{/, ' {')}\n${fields}`,
  );

  writeFileSync(path, src, 'utf8');
  return { path, changed: true, isBaseline };
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: node scripts/codemod-migration-shape.mjs <migration.ts> ...');
    process.exit(2);
  }
  let changed = 0;
  for (const p of paths) {
    const r = transform(p);
    if (r.changed) {
      changed++;
      console.log(
        `codemod: rewrote ${p} (${r.isBaseline ? 'baseline <never,End>' : 'with-start <Start,End>'})`,
      );
    } else {
      console.log(`codemod: skipped ${p} (${r.reason})`);
    }
  }
  console.log(`codemod: ${changed}/${paths.length} migration(s) rewritten`);
}

main();
