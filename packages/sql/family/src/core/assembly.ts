import type {
  ExtensionPackManifest,
  OperationManifest,
} from '@prisma-next/contract/pack-manifest-types';
import type { TypesImportSpec } from '@prisma-next/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry, OperationSignature } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
// Import private function from same package (test utility needs it)
import { convertOperationManifest } from './instance';

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
    const operations = descriptor.manifest.operations ?? [];
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
    const codecTypes = descriptor.manifest.types?.codecTypes;
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
    const operationTypes = descriptor.manifest.types?.operationTypes;
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

/**
 * Extracts codec type imports from extension packs for contract.d.ts generation.
 * Pack-based version for use in tests.
 */
export function extractCodecTypeImportsFromPacks(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const pack of packs) {
    const codecTypes = pack.manifest.types?.codecTypes;
    if (codecTypes?.import) {
      imports.push(codecTypes.import);
    }
  }

  return imports;
}

/**
 * Extracts operation type imports from extension packs for contract.d.ts generation.
 * Pack-based version for use in tests.
 */
export function extractOperationTypeImportsFromPacks(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const pack of packs) {
    const operationTypes = pack.manifest.types?.operationTypes;
    if (operationTypes?.import) {
      imports.push(operationTypes.import);
    }
  }

  return imports;
}

/**
 * Assembles an operation registry from extension packs.
 * Pack-based version for use in tests.
 */
export function assembleOperationRegistryFromPacks(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const pack of packs) {
    const operations = pack.manifest.operations ?? [];
    for (const operationManifest of operations as ReadonlyArray<OperationManifest>) {
      const signature = convertOperationManifest(operationManifest);
      registry.register(signature);
    }
  }

  return registry;
}

/**
 * Extracts extension IDs from packs.
 * Pack-based version for use in tests.
 */
export function extractExtensionIdsFromPacks(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): ReadonlyArray<string> {
  return packs.map((pack) => pack.manifest.id);
}
