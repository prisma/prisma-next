import type { TypesImportSpec } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/config-types';
import type {
  ExtensionPackManifest,
  OperationManifest,
} from '@prisma-next/core-control-plane/pack-manifest-types';
import type { OperationRegistry } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';

/**
 * Assembles an operation registry from descriptors (adapter, target, extensions).
 * Loops over descriptors, extracts operations, converts them using family-specific
 * conversion function, and registers them in a new registry.
 */
export function assembleOperationRegistry(
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
  family: FamilyDescriptor,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const descriptor of descriptors) {
    const operations = descriptor.manifest.operations ?? [];
    for (const operationManifest of operations as ReadonlyArray<OperationManifest>) {
      const signature = family.convertOperationManifest(operationManifest);
      registry.register(signature);
    }
  }

  return registry;
}

/**
 * Extracts codec type imports from descriptors for contract.d.ts generation.
 */
export function extractCodecTypeImports(
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
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
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
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
  adapter: AdapterDescriptor,
  target: TargetDescriptor,
  extensions: ReadonlyArray<ExtensionDescriptor>,
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
  family: FamilyDescriptor,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const pack of packs) {
    const operations = pack.manifest.operations ?? [];
    for (const operationManifest of operations as ReadonlyArray<OperationManifest>) {
      const signature = family.convertOperationManifest(operationManifest);
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

/**
 * Assembles a codec registry from adapter and extensions.
 * Creates adapter instance if needed, then registers adapter and extension codecs.
 * This is a general CLI helper for any command that needs codec registries.
 *
 * Extensions provide codecs via their runtime entrypoints (e.g., pgvector() returns Extension with codecs()).
 * For now, we only register adapter codecs. Extension codecs can be added later if needed for schema verification.
 */
export async function assembleCodecRegistry(
  adapter: AdapterDescriptor,
  _extensions: ReadonlyArray<ExtensionDescriptor>,
): Promise<CodecRegistry> {
  const codecRegistry = createCodecRegistry();

  // Get adapter instance (either pre-created or create via factory)
  let adapterInstance: { profile: { codecs(): CodecRegistry } } | undefined;
  if (adapter.adapter) {
    adapterInstance = adapter.adapter as {
      profile: { codecs(): CodecRegistry };
    };
  } else if (adapter.create) {
    const created = await adapter.create();
    adapterInstance = created as {
      profile: { codecs(): CodecRegistry };
    };
  }

  // Register adapter codecs
  if (adapterInstance) {
    const adapterCodecs = adapterInstance.profile.codecs();
    for (const codec of adapterCodecs.values()) {
      codecRegistry.register(codec);
    }
  }

  // TODO: Register extension codecs
  // Extensions provide codecs via their runtime entrypoints (e.g., pgvector() from @prisma-next/extension-pgvector/runtime).
  // This would require dynamically importing extension runtime modules, which is complex.
  // For MVP, adapter codecs are sufficient for schema verification.
  // Extension codecs can be added later if needed.

  return codecRegistry;
}
