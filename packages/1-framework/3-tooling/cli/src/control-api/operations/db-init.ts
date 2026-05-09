import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import type { DbInitResult, OnControlProgress } from '../types';
import { executePerSpaceDbApply, type PerSpaceExtensionInput } from './db-apply-per-space';

/**
 * Options for executing dbInit operation.
 *
 * `db init` always routes through {@link executePerSpaceDbApply} — even
 * when the workspace declares zero extension contract spaces — so the
 * orchestrator drives one symmetric path-resolver loop for both the
 * app and any extension spaces. {@link migrationsDir} is therefore
 * required (the per-space flow reads pinned `refs/head.json` and
 * extension destination contracts from this root).
 */
export interface ExecuteDbInitOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  /**
   * On-disk migrations directory the per-space flow reads pinned
   * artefacts from. Required — every `db init` walks the n=1 (app
   * only) or n=k+1 (extensions + app) resolver list, and the resolver
   * for any extension space reads its pinned `refs/head.json` from
   * `<migrationsDir>/<space-id>/refs/head.json`.
   *
   * @see docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md
   *   § "Lifecycle: who reads from where" — `db init` reads only
   *   on-disk pinned state, never descriptor modules.
   */
  readonly migrationsDir: string;
  /**
   * Declared extension contract spaces. Defaults to an empty list,
   * which routes the orchestrator through an n=1 (app-only) resolver
   * path — same code path, just one resolver instead of k+1.
   */
  readonly extensionContractSpaces?: ReadonlyArray<PerSpaceExtensionInput>;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Execute `db init` against the configured contract.
 *
 * Always routes through {@link executePerSpaceDbApply} so the
 * single-space and multi-space behaviours share one loop. The legacy
 * dual-path conditional (introspection/planning/idempotency/apply
 * inlined here when no extension spaces were declared) was deleted in
 * commit 3 of the M2 orchestrator-consolidation slice — the per-space
 * flow walks an n=1 resolver list and is bit-equivalent for the
 * app-only case.
 */
export async function executeDbInit<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbInitOptions<TFamilyId, TTargetId>,
): Promise<DbInitResult> {
  const {
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces = [],
    onProgress,
  } = options;
  const result = await executePerSpaceDbApply<TFamilyId, TTargetId>({
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces,
    // db init is additive-only.
    policy: { allowedOperationClasses: ['additive'] },
    action: 'dbInit',
    ...ifDefined('onProgress', onProgress),
  });
  return result as DbInitResult;
}
