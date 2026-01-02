import {
  checkContractComponentRequirements,
  type TargetBoundComponentDescriptor,
} from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { errorConfigValidation, errorContractMissingExtensionPacks } from './cli-errors';

/**
 * Asserts that all framework components are compatible with the expected family and target.
 *
 * This function validates that each component in the framework components array:
 * - Has kind 'target', 'adapter', 'extension', or 'driver'
 * - Has familyId matching expectedFamilyId
 * - Has targetId matching expectedTargetId
 *
 * This validation happens at the CLI composition boundary, before passing components
 * to typed planner/runner instances. It fills the gap between runtime validation
 * (via `validateConfig()`) and compile-time type enforcement.
 *
 * @param expectedFamilyId - The expected family ID (e.g., 'sql')
 * @param expectedTargetId - The expected target ID (e.g., 'postgres')
 * @param frameworkComponents - Array of framework components to validate
 * @returns The same array typed as TargetBoundComponentDescriptor
 * @throws CliStructuredError if any component is incompatible
 *
 * @example
 * ```ts
 * const config = await loadConfig();
 * const frameworkComponents = [config.target, config.adapter, ...(config.extensionPacks ?? [])];
 *
 * // Validate and type-narrow components before passing to planner
 * const typedComponents = assertFrameworkComponentsCompatible(
 *   config.family.familyId,
 *   config.target.targetId,
 *   frameworkComponents
 * );
 *
 * const planner = target.migrations.createPlanner(familyInstance);
 * planner.plan({ contract, schema, policy, frameworkComponents: typedComponents });
 * ```
 */
export function assertFrameworkComponentsCompatible<
  TFamilyId extends string,
  TTargetId extends string,
>(
  expectedFamilyId: TFamilyId,
  expectedTargetId: TTargetId,
  frameworkComponents: ReadonlyArray<unknown>,
): ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>> {
  for (let i = 0; i < frameworkComponents.length; i++) {
    const component = frameworkComponents[i];

    // Check that component is an object
    if (typeof component !== 'object' || component === null) {
      throw errorConfigValidation('frameworkComponents[]', {
        why: `Framework component at index ${i} must be an object`,
      });
    }

    const record = component as Record<string, unknown>;

    // Check kind
    if (!Object.hasOwn(record, 'kind')) {
      throw errorConfigValidation('frameworkComponents[].kind', {
        why: `Framework component at index ${i} must have 'kind' property`,
      });
    }

    const kind = record['kind'];
    if (kind !== 'target' && kind !== 'adapter' && kind !== 'extension' && kind !== 'driver') {
      throw errorConfigValidation('frameworkComponents[].kind', {
        why: `Framework component at index ${i} has invalid kind '${String(kind)}' (must be 'target', 'adapter', 'extension', or 'driver')`,
      });
    }

    // Check familyId
    if (!Object.hasOwn(record, 'familyId')) {
      throw errorConfigValidation('frameworkComponents[].familyId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) must have 'familyId' property`,
      });
    }

    const familyId = record['familyId'];
    if (familyId !== expectedFamilyId) {
      throw errorConfigValidation('frameworkComponents[].familyId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) has familyId '${String(familyId)}' but expected '${expectedFamilyId}'`,
      });
    }

    // Check targetId
    if (!Object.hasOwn(record, 'targetId')) {
      throw errorConfigValidation('frameworkComponents[].targetId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) must have 'targetId' property`,
      });
    }

    const targetId = record['targetId'];
    if (targetId !== expectedTargetId) {
      throw errorConfigValidation('frameworkComponents[].targetId', {
        why: `Framework component at index ${i} (kind: ${String(kind)}) has targetId '${String(targetId)}' but expected '${expectedTargetId}'`,
      });
    }
  }

  // Type assertion is safe because we've validated all components above
  return frameworkComponents as ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
}

/**
 * Validates that a contract is compatible with the configured family, target, adapter,
 * and extension packs. Throws on family/target mismatches or missing extension packs.
 *
 * This check ensures the emitted contract matches the CLI config before running
 * commands that depend on the contract (e.g., db verify, db sign).
 *
 * @param contract - The contract IR to validate (must include targetFamily, target, extensionPacks).
 * @param family - The configured family descriptor.
 * @param target - The configured target descriptor.
 * @param adapter - The configured adapter descriptor.
 * @param extensionPacks - Optional array of extension descriptors provided by the config.
 *
 * @throws {CliStructuredError} errorConfigValidation when contract.targetFamily or contract.target
 *   doesn't match the configured family/target.
 * @throws {CliStructuredError} errorContractMissingExtensionPacks when the contract requires
 *   extension packs that are not provided in the config (includes all missing packs in error.meta).
 *
 * @example
 * ```ts
 * import { assertContractRequirementsSatisfied } from './framework-components';
 *
 * const config = await loadConfig();
 * const contractIR = await loadContractJson(config.contract.output);
 *
 * // Throws if contract is incompatible with config
 * assertContractRequirementsSatisfied({
 *   contract: contractIR,
 *   family: config.family,
 *   target: config.target,
 *   adapter: config.adapter,
 *   extensionPacks: config.extensionPacks,
 * });
 * ```
 */
export function assertContractRequirementsSatisfied<
  TFamilyId extends string,
  TTargetId extends string,
>({
  contract,
  family,
  target,
  adapter,
  extensionPacks,
}: {
  readonly contract: Pick<ContractIR, 'targetFamily' | 'target' | 'extensionPacks'>;
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensionPacks?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[] | undefined;
}): void {
  const providedComponentIds = new Set<string>([target.id, adapter.id]);
  for (const extension of extensionPacks ?? []) {
    providedComponentIds.add(extension.id);
  }

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: family.familyId,
    expectedTargetId: target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw errorConfigValidation('contract.targetFamily', {
      why: `Contract was emitted for family '${result.familyMismatch.actual}' but CLI config is wired to '${result.familyMismatch.expected}'.`,
    });
  }

  if (result.targetMismatch) {
    throw errorConfigValidation('contract.target', {
      why: `Contract target '${result.targetMismatch.actual}' does not match CLI target '${result.targetMismatch.expected}'.`,
    });
  }

  if (result.missingExtensionPackIds.length > 0) {
    throw errorContractMissingExtensionPacks({
      missingExtensionPacks: result.missingExtensionPackIds,
      providedComponentIds: [...providedComponentIds],
    });
  }
}
