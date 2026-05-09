import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'pathe';
import { canonicalizeJson } from './canonicalize-json';
import type { ContractSpaceHeadRef } from './read-contract-space-head-ref';
import { assertValidSpaceId } from './space-layout';

/**
 * Inputs for {@link emitContractSpaceArtefacts}.
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
 * - `headRef` is the head reference for the space.
 *   `invariants` are sorted alphabetically before serialisation so two
 *   callers passing the same set in different orders produce
 *   byte-identical `refs/head.json`.
 */
export interface ContractSpaceArtefactInputs {
  readonly contract: unknown;
  readonly contractDts: string;
  readonly headRef: ContractSpaceHeadRef;
}

/**
 * Emit the per-space artefacts (`contract.json`, `contract.d.ts`,
 * `refs/head.json`) under `<projectMigrationsDir>/<spaceId>/`.
 *
 * Always-overwrite: the framework owns these files; running `migrate`
 * twice with the same inputs is a no-op observably (idempotent), but the
 * helper does not check pre-existing contents — re-emit always wins.
 *
 * Path layout matches the convention in
 * [`spaceMigrationDirectory`](./space-layout.ts). The space id is
 * validated against `[a-z][a-z0-9_-]{0,63}` via
 * {@link assertValidSpaceId} for filesystem-safety reasons; the helper
 * accepts every space uniformly (including the app space, default
 * `'app'`).
 *
 * The migrations directory and space subdirectory are created if they
 * do not yet exist (`mkdir { recursive: true }`).
 */
export async function emitContractSpaceArtefacts(
  projectMigrationsDir: string,
  spaceId: string,
  inputs: ContractSpaceArtefactInputs,
): Promise<void> {
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
