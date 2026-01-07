import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';

import type {
  RuntimeAdapterDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeFamilyDescriptor,
  RuntimeTargetDescriptor,
} from './types.ts';

/**
 * Asserts that runtime component descriptors satisfy contract requirements.
 *
 * Routes the same framework composition through validation as control-plane:
 * family, target, adapter, extensionPacks (all as descriptors with IDs).
 *
 * @throws Error if contract target doesn't match the provided target descriptor
 * @throws Error if contract requires extension packs not provided in descriptors
 */
export function assertRuntimeContractRequirementsSatisfied<
  TFamilyId extends string,
  TTargetId extends string,
>({
  contract,
  family,
  target,
  adapter,
  extensionPacks,
}: {
  readonly contract: { readonly target: string; readonly extensionPacks?: Record<string, unknown> };
  readonly family: RuntimeFamilyDescriptor<TFamilyId>;
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensionPacks: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
}): void {
  // Build set of provided component IDs from descriptors
  const providedComponentIds = new Set<string>([family.id, target.id, adapter.id]);
  for (const extension of extensionPacks) {
    providedComponentIds.add(extension.id);
  }

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetId: target.targetId,
    providedComponentIds,
  });

  if (result.targetMismatch) {
    throw new Error(
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
    );
  }

  // Strict enforcement: all extension packs required by contract must be provided as descriptors
  for (const packId of result.missingExtensionPackIds) {
    throw new Error(
      `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
    );
  }
}
