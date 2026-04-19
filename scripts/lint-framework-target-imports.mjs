#!/usr/bin/env node
/**
 * Regression guardrail: fails if any `@prisma-next/target-*` text appears
 * inside `packages/1-framework/**`.
 *
 * Background: the regular dependency linter (`pnpm lint:deps`) catches real
 * `import` statements, but it can't see import specifiers that are only
 * embedded inside string literals (e.g. code that scaffolds a migration.ts
 * file with a literal `import { ... } from "@prisma-next/target-..."`).
 *
 * After the target-owned-scaffolding refactor (see
 * `projects/mongo-migration-authoring/specs/target-owned-migration-scaffolding.md`),
 * the framework no longer renders any part of a migration.ts file — targets
 * own the full content. As a result there are no known violations today, and
 * this script acts purely as a regression guardrail: any future attempt to
 * reintroduce a string-encoded target import into Domain 1 will fail the
 * `pnpm lint:deps` run that executes this check.
 *
 * Domain 1 (framework) must never name a Domain 3 (target) package, not even
 * inside a string. See `.cursor/rules/directory-layout.mdc`.
 *
 * Exits with code 1 and prints offending locations if any violations are
 * found; exits with code 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_SUBSTRING = '@prisma-next/target-';
const FRAMEWORK_ROOT = 'packages/1-framework';
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  // These directories contain code that is *generated for user projects*,
  // not framework code. Naming target packages there is expected.
  'templates',
  'recordings',
  'fixtures',
]);

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (stat.isFile() && INCLUDED_EXTENSIONS.has(extname(full))) {
      yield full;
    }
  }
}

const violations = [];

for (const file of walk(join(repoRoot, FRAMEWORK_ROOT))) {
  const contents = readFileSync(file, 'utf8');
  if (!contents.includes(FORBIDDEN_SUBSTRING)) continue;
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(FORBIDDEN_SUBSTRING)) continue;
    const trimmed = line.trimStart();
    // Skip JSDoc and line comments — these are documentation, not runtime behaviour.
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    violations.push({
      file: relative(repoRoot, file),
      line: i + 1,
      text: line.trim(),
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Found ${violations.length} import specifier(s) naming @prisma-next/target-* inside ${FRAMEWORK_ROOT}:`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error(
    '\nDomain 1 (framework) must not depend on Domain 3 (target) packages — ' +
      'including string-encoded import specifiers. See .cursor/rules/directory-layout.mdc.',
  );
  process.exit(1);
}

console.log(`No @prisma-next/target-* references found inside ${FRAMEWORK_ROOT}.`);
