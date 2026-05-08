import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk } from '@prisma-next/utils/result';
import type { DbUpdateResult, OnControlProgress } from '../types';
import { executePerSpaceDbApply, type PerSpaceExtensionInput } from './db-apply-per-space';

// F12: db update allows additive, widening, and destructive operations.
const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
} as const;

/**
 * Options for the executeDbUpdate operation.
 *
 * `db update` always routes through {@link executePerSpaceDbApply} so
 * the single-space and multi-space behaviours share one loop.
 * {@link migrationsDir} is required; {@link extensionContractSpaces}
 * defaults to an empty list (n=1 app-only resolver path).
 */
export interface ExecuteDbUpdateOptions<TFamilyId extends string, TTargetId extends string> {
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
  readonly acceptDataLoss?: boolean;
  /**
   * On-disk migrations directory the per-space flow reads pinned
   * artefacts from.
   *
   * @see projects/extension-contract-spaces/specs/m2-orchestrator-consolidation-spec.md
   *   § "One-path `db init`" (the same property holds for `db update`).
   */
  readonly migrationsDir: string;
  /**
   * Declared extension contract spaces. Defaults to an empty list.
   */
  readonly extensionContractSpaces?: ReadonlyArray<PerSpaceExtensionInput>;
  /** Optional progress callback for observing operation progress. */
  readonly onProgress?: OnControlProgress;
}

/**
 * Execute `db update` against the configured contract.
 *
 * Always routes through {@link executePerSpaceDbApply}. Destructive
 * operations require either `acceptDataLoss: true` or a prior
 * `mode: 'plan'` invocation that surfaces the destructive ops; the
 * gate is implemented here at the orchestrator level so the per-space
 * applier remains policy-agnostic.
 */
export async function executeDbUpdate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbUpdateOptions<TFamilyId, TTargetId>,
): Promise<DbUpdateResult> {
  const {
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces = [],
    acceptDataLoss,
    onProgress,
  } = options;

  // Apply mode without `acceptDataLoss` first plans across every
  // declared space and rejects if any destructive op is in the
  // aggregate plan. Mirrors the legacy single-space `db update`
  // contract — destructive changes surface to the user before any
  // writes — but evaluated against the cross-space plan so the
  // confirmation gate is consistent regardless of cardinality.
  if (mode === 'apply' && !acceptDataLoss) {
    const planResult = (await executePerSpaceDbApply<TFamilyId, TTargetId>({
      driver,
      familyInstance,
      contract,
      mode: 'plan',
      migrations,
      frameworkComponents,
      migrationsDir,
      extensionContractSpaces,
      policy: DB_UPDATE_POLICY,
      action: 'dbUpdate',
      ...ifDefined('onProgress', onProgress),
    })) as DbUpdateResult;
    if (!planResult.ok) return planResult;
    const destructiveOps = planResult.value.plan.operations
      .filter((op) => op.operationClass === 'destructive')
      .map((op) => ({ id: op.id, label: op.label }));
    if (destructiveOps.length > 0) {
      return notOk({
        code: 'DESTRUCTIVE_CHANGES',
        summary: `Planned ${destructiveOps.length} destructive operation(s) that require confirmation`,
        why: 'Destructive operations require confirmation — re-run with -y to accept',
        conflicts: undefined,
        meta: { destructiveOperations: destructiveOps },
      });
    }
  }

  const result = (await executePerSpaceDbApply<TFamilyId, TTargetId>({
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces,
    policy: DB_UPDATE_POLICY,
    action: 'dbUpdate',
    ...ifDefined('onProgress', onProgress),
  })) as DbUpdateResult;
  return result;
}
