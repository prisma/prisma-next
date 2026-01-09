import type {
  NormalizedTypeRenderer,
  TypeRenderer,
} from '@prisma-next/contract/framework-components';
import { normalizeRenderer } from '@prisma-next/contract/framework-components';
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

/**
 * Extracts and normalizes parameterized codec renderers from descriptors.
 * Templates are compiled to functions at this layer.
 *
 * Throws an error if multiple descriptors provide a renderer for the same codecId.
 * This is intentional - duplicate codecId is a hard error, not a silent override.
 *
 * @returns Map from codecId to normalized renderer
 */
export function extractParameterizedRenderers(
  descriptors: ReadonlyArray<
    | ControlTargetDescriptor<'sql', string>
    | ControlAdapterDescriptor<'sql', string>
    | ControlExtensionDescriptor<'sql', string>
  >,
): Map<string, NormalizedTypeRenderer> {
  const renderers = new Map<string, NormalizedTypeRenderer>();
  const owners = new Map<string, string>(); // codecId -> descriptor.id for error messages

  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    if (!codecTypes?.parameterized) continue;

    const parameterized: Record<string, TypeRenderer> = codecTypes.parameterized;
    for (const [codecId, renderer] of Object.entries(parameterized)) {
      const existingOwner = owners.get(codecId);
      if (existingOwner !== undefined) {
        throw new Error(
          `Duplicate parameterized renderer for codecId "${codecId}". ` +
            `Descriptor "${descriptor.id}" conflicts with "${existingOwner}". ` +
            'Each codecId can only have one renderer.',
        );
      }

      renderers.set(codecId, normalizeRenderer(codecId, renderer));
      owners.set(codecId, descriptor.id);
    }
  }

  return renderers;
}

/**
 * Extracts parameterized type imports from descriptors for contract.d.ts generation.
 * These are type imports needed by parameterized codec renderers.
 *
 * @returns Array of type import specs (may contain duplicates; caller should deduplicate)
 */
export function extractParameterizedTypeImports(
  descriptors: ReadonlyArray<
    | ControlTargetDescriptor<'sql', string>
    | ControlAdapterDescriptor<'sql', string>
    | ControlExtensionDescriptor<'sql', string>
  >,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const parameterizedImports = descriptor.types?.codecTypes?.parameterizedImports;
    if (parameterizedImports) {
      imports.push(...parameterizedImports);
    }
  }

  return imports;
}
