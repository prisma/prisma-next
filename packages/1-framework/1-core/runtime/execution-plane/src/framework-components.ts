import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';

import type {
  RuntimeAdapterDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from './types';

export function assertRuntimeContractRequirementsSatisfied<
  TFamilyId extends string,
  TTargetId extends string,
>({
  contract,
  target,
  adapter,
  extensions: extensionPacks,
  runtimeExtensionPacksProvided,
}: {
  readonly contract: { readonly target: string; readonly extensionPacks?: Record<string, unknown> };
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  readonly runtimeExtensionPacksProvided?: boolean | undefined;
}): void {
  const providedComponentIds = new Set<string>([target.id, adapter.id]);
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

  if (runtimeExtensionPacksProvided === true) {
    return;
  }

  for (const packId of result.missingExtensionPackIds) {
    throw new Error(
      `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
    );
  }
}
