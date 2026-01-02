import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { errorConfigValidation } from './cli-errors';

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
 * const frameworkComponents = [config.target, config.adapter, ...(config.extensions ?? [])];
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

export function assertContractRequirementsSatisfied<
  TFamilyId extends string,
  TTargetId extends string,
>({
  contract,
  family,
  target,
  adapter,
  extensions,
}: {
  readonly contract: Pick<ContractIR, 'targetFamily' | 'target' | 'extensionPacks'>;
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensions?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
}): void {
  if (contract.targetFamily !== family.familyId) {
    throw errorConfigValidation('contract.targetFamily', {
      why: `Contract was emitted for family '${contract.targetFamily}' but CLI config is wired to '${family.familyId}'.`,
    });
  }

  if (contract.target !== target.targetId) {
    throw errorConfigValidation('contract.target', {
      why: `Contract target '${contract.target}' does not match CLI target '${target.targetId}'.`,
    });
  }

  const providedComponentIds = new Set<string>([target.id, adapter.id]);
  for (const extension of extensions ?? []) {
    providedComponentIds.add(extension.id);
  }

  const requiredPacks = contract.extensionPacks ? Object.keys(contract.extensionPacks) : [];
  for (const packId of requiredPacks) {
    if (!providedComponentIds.has(packId)) {
      throw errorConfigValidation('contract.extensionPacks', {
        why: `Contract requires extension pack '${packId}', but CLI config does not provide a matching descriptor.`,
      });
    }
  }
}
