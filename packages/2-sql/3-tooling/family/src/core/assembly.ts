import type { OperationManifest } from '@prisma-next/contract/pack-manifest-types';
import type { TypesImportSpec } from '@prisma-next/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry, OperationSignature } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';

/**
 * Assembles an operation registry from descriptors (adapter, target, extensions).
 * Loops over descriptors, extracts operations, converts them using the provided
 * conversion function, and registers them in a new registry.
 */
export function assembleOperationRegistry(
  descriptors: ReadonlyArray<
    | ControlTargetDescriptor<'sql', string>
    | ControlAdapterDescriptor<'sql', string>
    | ControlExtensionDescriptor<'sql', string>
  >,
  convertOperationManifest: (manifest: OperationManifest) => OperationSignature,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const descriptor of descriptors) {
    const operations = descriptor.operations ?? [];
    for (const operationManifest of operations as ReadonlyArray<OperationManifest>) {
      const signature = convertOperationManifest(operationManifest);
      registry.register(signature);
    }
  }

  return registry;
}

/**
 * Extracts codec type imports from descriptors for contract.d.ts generation.
 */
export function extractCodecTypeImports(
  descriptors: ReadonlyArray<
    | ControlTargetDescriptor<'sql', string>
    | ControlAdapterDescriptor<'sql', string>
    | ControlExtensionDescriptor<'sql', string>
  >,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const codecTypes = types?.codecTypes;
    if (codecTypes?.import) {
      imports.push(codecTypes.import);
    }
  }

  return imports;
}

/**
 * Extracts operation type imports from descriptors for contract.d.ts generation.
 */
export function extractOperationTypeImports(
  descriptors: ReadonlyArray<
    | ControlTargetDescriptor<'sql', string>
    | ControlAdapterDescriptor<'sql', string>
    | ControlExtensionDescriptor<'sql', string>
  >,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const operationTypes = types?.operationTypes;
    if (operationTypes?.import) {
      imports.push(operationTypes.import);
    }
  }

  return imports;
}

/**
 * Extracts extension IDs from descriptors in deterministic order:
 * [adapter.id, target.id, ...extensions.map(e => e.id)]
 * Deduplicates while preserving stable order.
 */
export function extractExtensionIds(
  adapter: ControlAdapterDescriptor<'sql', string>,
  target: ControlTargetDescriptor<'sql', string>,
  extensions: ReadonlyArray<ControlExtensionDescriptor<'sql', string>>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();

  // Add adapter first
  if (!seen.has(adapter.id)) {
    ids.push(adapter.id);
    seen.add(adapter.id);
  }

  // Add target second
  if (!seen.has(target.id)) {
    ids.push(target.id);
    seen.add(target.id);
  }

  // Add extensions in order
  for (const ext of extensions) {
    if (!seen.has(ext.id)) {
      ids.push(ext.id);
      seen.add(ext.id);
    }
  }

  return ids;
}
