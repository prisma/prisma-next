import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'pathe';
import { canonicalizeJson } from './canonicalize-json';
import { errorPinnedArtefactsAppSpace } from './errors';
import { APP_SPACE_ID, assertValidSpaceId } from './space-layout';

/**
 * Pinned head reference for a contract space — `(hash, invariants)`.
 * Mirrors {@link import('./refs').RefEntry} but is redeclared locally so
 * callers can construct the input without depending on the refs module.
 */
export interface PinnedSpaceHeadRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Inputs for {@link emitPinnedSpaceArtefacts}.
 *
 * - `contract` is the canonical contract value the framework just emitted
 *   for the space; it is serialised through {@link canonicalizeJson}, so
 *   it must be a JSON-compatible value (objects / arrays / primitives).
 *   Typed as `unknown` rather than the SQL-family `Contract<SqlStorage>`
 *   to keep `migration-tools` framework-neutral; SQL-family callers pass
 *   their typed value through unchanged.
 *
 * - `contractDts` is the pre-rendered `.d.ts` text. Rendering happens in
 *   the SQL family (which owns the codec / typemap input the renderer
 *   needs), so this helper accepts the text verbatim and writes it out
 *   without further transformation.
 *
 * - `headRef` is the pinned head reference for the space.
 *   `invariants` are sorted alphabetically before serialisation so two
 *   callers passing the same set in different orders produce
 *   byte-identical `refs/head.json`.
 */
export interface PinnedSpaceArtefactInputs {
  readonly contract: unknown;
  readonly contractDts: string;
  readonly headRef: PinnedSpaceHeadRef;
}

/**
 * Emit the pinned per-space artefacts (`contract.json`, `contract.d.ts`,
 * `refs/head.json`) under `<projectMigrationsDir>/<spaceId>/`.
 *
 * Always-overwrite: the framework owns these files; running `migrate`
 * twice with the same inputs is a no-op observably (idempotent), but the
 * helper does not check pre-existing contents — re-emit always wins.
 *
 * Path layout matches the convention in
 * [`spaceMigrationDirectory`](./space-layout.ts), with two restrictions
 * specific to pinned artefacts:
 *
 * - Rejects the app space (`spaceId === APP_SPACE_ID`): the app space's
 *   canonical `contract.json` lives at the project root, not under
 *   `migrations/`. Callers that want to emit it use the app-space
 *   contract emit pipeline.
 * - Validates `spaceId` against `[a-z][a-z0-9_-]{0,63}` via
 *   {@link assertValidSpaceId} for the same filesystem-safety reasons.
 *
 * The migrations directory and space subdirectory are created if they
 * do not yet exist (`mkdir { recursive: true }`).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Pinned artefact emission (T1.8).
 */
export async function emitPinnedSpaceArtefacts(
  projectMigrationsDir: string,
  spaceId: string,
  inputs: PinnedSpaceArtefactInputs,
): Promise<void> {
  if (spaceId === APP_SPACE_ID) {
    throw errorPinnedArtefactsAppSpace();
  }
  assertValidSpaceId(spaceId);

  const dir = join(projectMigrationsDir, spaceId);
  await mkdir(join(dir, 'refs'), { recursive: true });

  await writeFile(join(dir, 'contract.json'), `${canonicalizeJson(inputs.contract)}\n`);
  await writeFile(join(dir, 'contract.d.ts'), inputs.contractDts);

  const sortedInvariants = [...inputs.headRef.invariants].sort();
  const headJson = canonicalizeJson({
    hash: inputs.headRef.hash,
    invariants: sortedInvariants,
  });
  await writeFile(join(dir, 'refs', 'head.json'), `${headJson}\n`);
}
