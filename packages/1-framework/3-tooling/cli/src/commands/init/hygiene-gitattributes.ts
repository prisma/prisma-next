import type { TargetId } from './templates/code-templates';

/**
 * The schema-relative `.gitattributes` entries written for a freshly
 * initialised project (FR3.4). Mirrors the relevant subset of the
 * repo-root [`.gitattributes`](../../../../../../../../.gitattributes):
 *
 * - **Today**: `contract.json`, `contract.d.ts` are emitted on every
 *   `prisma-next contract emit`. Marking them `linguist-generated`
 *   keeps GitHub's diff stats honest and collapses the file in code
 *   review by default.
 * - **Forward-looking**: `end-contract.*`, `start-contract.*`, `ops.json`,
 *   `migration.json` are not yet emitted by `init` flows but will be
 *   produced by adjacent commands (lower / migration tooling). Adding
 *   them now matches Decision 5 (forward-looking subset) so the file
 *   does not need to be amended every time a new artefact lands.
 *
 * Patterns are written relative to the schema directory so a user
 * who runs `init --schema-path db/contract.prisma` gets
 * `db/contract.json linguist-generated` — not the workspace-glob form
 * `<glob>/contract.json` (which would over-match any unrelated
 * `contract.json` the user has elsewhere) and not the absolute
 * `prisma/contract.json` (which would silently break for a non-default
 * schema path).
 */
const ARTEFACT_FILENAMES: readonly string[] = [
  'contract.json',
  'contract.d.ts',
  'end-contract.json',
  'end-contract.d.ts',
  'start-contract.json',
  'start-contract.d.ts',
  'ops.json',
  'migration.json',
];

const ATTRIBUTE = 'linguist-generated';

/**
 * Computes the `.gitattributes` lines this scaffold expects to own. Each
 * line has the shape `<path> linguist-generated`. The `target` parameter
 * is currently unused but accepted for symmetry with the other hygiene
 * helpers and to leave room for target-specific entries (e.g. a future
 * Mongo-only artefact) without a signature break.
 */
export function requiredGitattributesLines(
  schemaDir: string,
  _target: TargetId,
): readonly string[] {
  const dir = schemaDir === '.' ? '' : schemaDir.replace(/\/+$/, '');
  const prefix = dir === '' ? '' : `${dir}/`;
  return ARTEFACT_FILENAMES.map((file) => `${prefix}${file} ${ATTRIBUTE}`);
}

/**
 * Idempotent `.gitattributes` merge (FR3.4 / FR9.3). Returns the new file
 * content given the existing content (or `undefined` if the file does
 * not yet exist).
 *
 * Equivalence is exact-line: a user-customised line like
 * `prisma/*.json linguist-generated` is *not* recognised as covering
 * `prisma/contract.json linguist-generated`. We accept that
 * over-specification — preserving the user's broad pattern *and*
 * appending the narrow one — because the narrow lines are what the
 * acceptance criteria pin (FR3.4 AC).
 *
 * Returns `null` when no changes are required (file already contains
 * every required entry).
 */
export function mergeGitattributes(
  existing: string | undefined,
  required: readonly string[],
): string | null {
  if (existing === undefined) {
    return `${required.join('\n')}\n`;
  }

  const presentLines = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  const missing = required.filter((line) => !presentLines.has(line));
  if (missing.length === 0) {
    return null;
  }

  const trailingNewline = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${trailingNewline}${missing.join('\n')}\n`;
}
