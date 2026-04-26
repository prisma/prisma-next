import type { TargetId } from './code-templates';

/**
 * The minimum supported server version for each target. M7 (FR8.1) will
 * read this value from the target package's `package.json#prismaNext.minServerVersion`
 * field; until then this module is the single source of truth so the
 * scaffold's `.env.example` (FR3.1, FR8.2) does not lie about what the
 * runtime actually supports.
 *
 * Bumping a value here in isolation is safe — it only changes the
 * `# Requires …` comment in `.env.example`. Bumping the runtime support
 * is the M7 contract and lives elsewhere.
 */
const MIN_SERVER_VERSION: Record<TargetId, string> = {
  postgres: '14',
  mongo: '6.0',
};

const TARGET_LABEL: Record<TargetId, string> = {
  postgres: 'PostgreSQL',
  mongo: 'MongoDB',
};

/**
 * Renders the `.env.example` content for a given target (FR3.1):
 *
 * - Documents the `DATABASE_URL` placeholder in the target's native URL
 *   shape (Postgres: standard `postgresql://`, Mongo: `mongodb://` plus
 *   a `mydb` database segment so the lazy facade has a `dbName`).
 * - Carries a `# Requires <db> >= <version>` comment so a fresh user
 *   knows the minimum supported server before they first try to
 *   connect (FR8.2).
 *
 * The output is identical for both authoring styles — the env file is
 * orthogonal to PSL vs TS schema authoring.
 */
export function envExampleContent(target: TargetId): string {
  const label = TARGET_LABEL[target];
  const minVersion = MIN_SERVER_VERSION[target];
  const lines: string[] = [];
  lines.push(`# Connection string for ${label}.`);
  lines.push(`# Requires ${label} >= ${minVersion}.`);
  lines.push(
    '# Copy this file to `.env` and replace the placeholder with your real connection string.',
  );
  lines.push('');
  if (target === 'postgres') {
    lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"');
  } else {
    lines.push('DATABASE_URL="mongodb://localhost:27017/mydb"');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Renders the initial `.env` content for `--write-env` / interactive
 * opt-in (FR3.2). Same shape as `.env.example` so a user can edit a
 * single placeholder rather than hunting through comments. Writing this
 * file is gitignored (FR3.3 ensures `.env` lands in `.gitignore`).
 */
export function envFileContent(target: TargetId): string {
  return envExampleContent(target);
}
