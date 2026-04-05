import type {
  RuntimeAdapterDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeFamilyDescriptor,
  RuntimeTargetDescriptor,
} from './execution-descriptors';
import { checkContractComponentRequirements } from './framework-components';

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

  for (const packId of result.missingExtensionPackIds) {
    throw new Error(
      `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
    );
  }
}
