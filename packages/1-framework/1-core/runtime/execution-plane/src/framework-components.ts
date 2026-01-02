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
  extensions,
  runtimeExtensionPacksProvided,
}: {
  readonly contract: { readonly target: string; readonly extensionPacks?: Record<string, unknown> };
  readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  readonly runtimeExtensionPacksProvided?: boolean | undefined;
}): void {
  const providedComponentIds = new Set<string>([target.id, adapter.id]);
  for (const extension of extensions) {
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
    // Runtime extension packs don't have IDs - log warning and defer validation to runtime.
    if (result.missingExtensionPackIds.length > 0) {
      console.warn(
        `Contract requires extension pack(s) [${result.missingExtensionPackIds.join(', ')}], ` +
          `but cannot verify against runtime extensions (they don't have IDs). ` +
          'Validation will occur at runtime when codecs/operations are used.',
      );
    }
    return;
  }

  for (const packId of result.missingExtensionPackIds) {
    throw new Error(
      `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
    );
  }
}
