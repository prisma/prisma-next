import type {
  AdapterDescriptor,
  ExtensionDescriptor,
  TargetDescriptor,
} from '@prisma-next/cli/config-types';
import type { TypesImportSpec } from '@prisma-next/emitter';
import {
  createSqlOperationRegistry,
  register,
  type SqlOperationRegistry,
  type SqlOperationSignature,
} from '@prisma-next/sql-operations';
import type { ExtensionPackManifest, OperationManifest } from './pack-manifest-types';

/**
 * Converts an OperationManifest (from ExtensionPackManifest) to a SqlOperationSignature.
 */
export function operationManifestToSignature(manifest: OperationManifest): SqlOperationSignature {
  return {
    forTypeId: manifest.for,
    method: manifest.method,
    args: manifest.args.map((arg: OperationManifest['args'][number]) => {
      if (arg.kind === 'typeId') {
        if (!arg.type) {
          throw new Error('typeId arg must have type property');
        }
        return { kind: 'typeId' as const, type: arg.type };
      }
      if (arg.kind === 'param') {
        return { kind: 'param' as const };
      }
      if (arg.kind === 'literal') {
        return { kind: 'literal' as const };
      }
      throw new Error(`Invalid arg kind: ${(arg as { kind: unknown }).kind}`);
    }),
    returns: (() => {
      if (manifest.returns.kind === 'typeId') {
        return { kind: 'typeId' as const, type: manifest.returns.type };
      }
      if (manifest.returns.kind === 'builtin') {
        return {
          kind: 'builtin' as const,
          type: manifest.returns.type as 'number' | 'boolean' | 'string',
        };
      }
      throw new Error(`Invalid return kind: ${(manifest.returns as { kind: unknown }).kind}`);
    })(),
    lowering: {
      targetFamily: 'sql',
      strategy: manifest.lowering.strategy,
      template: manifest.lowering.template,
    },
    ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
  };
}

/**
 * Assembles an operation registry from descriptors (adapter, target, extensions).
 * Extracts OperationManifest[] from descriptor manifests, converts them to SqlOperationSignature,
 * and registers them in a new registry.
 */
export function assembleOperationRegistryFromDescriptors(
  descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
): SqlOperationRegistry {
  const registry = createSqlOperationRegistry();

  for (const descriptor of descriptors) {
    const operations = descriptor.manifest.operations ?? [];
    for (const operationManifest of operations) {
      const signature = operationManifestToSignature(operationManifest);
      register(registry, signature);
    }
  }

  return registry;
}

/**
 * Extracts codec type imports from descriptors for contract.d.ts generation.
 */
export function extractCodecTypeImportsFromDescriptors(
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
export function extractOperationTypeImportsFromDescriptors(
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
export function extractExtensionIdsFromDescriptors(
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
 * Assembles an operation registry from extension packs.
 * Extracts OperationManifest[] from packs, converts them to SqlOperationSignature,
 * and registers them in a new registry.
 */
export function assembleOperationRegistryFromPacks(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): SqlOperationRegistry {
  const registry = createSqlOperationRegistry();

  for (const pack of packs) {
    const operations = pack.manifest.operations ?? [];
    for (const operationManifest of operations) {
      const signature = operationManifestToSignature(operationManifest);
      register(registry, signature);
    }
  }

  return registry;
}

/**
 * Extracts codec type imports from extension packs for contract.d.ts generation.
 */
export function extractCodecTypeImports(
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
 */
export function extractOperationTypeImports(
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
 * Extracts extension IDs from packs for extension validation.
 */
export function extractExtensionIds(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): ReadonlyArray<string> {
  return packs.map((pack) => pack.manifest.id);
}

/**
 * @deprecated Use extractCodecTypeImports and extractOperationTypeImports instead
 * Extracts all type imports from extension packs (both codec and operation types).
 * Kept for backward compatibility during migration.
 */
export function extractTypeImports(
  packs: ReadonlyArray<{ readonly manifest: ExtensionPackManifest }>,
): ReadonlyArray<TypesImportSpec> {
  return [...extractCodecTypeImports(packs), ...extractOperationTypeImports(packs)];
}
