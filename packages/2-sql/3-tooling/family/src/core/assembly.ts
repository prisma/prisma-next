import type {
  NormalizedTypeRenderer,
  TargetBoundComponentDescriptor,
  TypeRenderer,
} from '@prisma-next/contract/framework-components';
import { normalizeRenderer } from '@prisma-next/contract/framework-components';
import type { TypesImportSpec } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import type { CodecControlHooks, SqlControlStaticContributions } from './migrations/types';

function addUniqueId(ids: string[], seen: Set<string>, id: string): void {
  if (!seen.has(id)) {
    ids.push(id);
    seen.add(id);
  }
}

function assertUniqueCodecOwner(options: {
  readonly codecId: string;
  readonly owners: Map<string, string>;
  readonly descriptorId: string;
  readonly entityLabel: string;
  readonly entityOwnershipLabel: string;
}): void {
  const existingOwner = options.owners.get(options.codecId);
  if (existingOwner !== undefined) {
    throw new Error(
      `Duplicate ${options.entityLabel} for codecId "${options.codecId}". ` +
        `Descriptor "${options.descriptorId}" conflicts with "${existingOwner}". ` +
        `Each codecId can only have one ${options.entityOwnershipLabel}.`,
    );
  }
}

// ============================================================================
// Operation Registry Assembly
// ============================================================================
/**
 * Descriptor type that provides static contributions for SQL control plane assembly.
 * Includes component identity (id, types) plus required operationSignatures() method.
 */
export interface SqlControlDescriptorWithContributions extends SqlControlStaticContributions {
  readonly id: string;
  readonly types?: {
    readonly codecTypes?: {
      readonly import?: TypesImportSpec;
      readonly parameterized?: Record<string, TypeRenderer>;
      readonly typeImports?: ReadonlyArray<TypesImportSpec>;
    };
    readonly operationTypes?: { readonly import: TypesImportSpec };
  };
}

/**
 * Assembles an operation registry from descriptors with static contributions.
 * Loops over descriptors, calls operationSignatures(), and registers them in a new registry.
 */
export function assembleOperationRegistry(
  descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const descriptor of descriptors) {
    const signatures = descriptor.operationSignatures();
    for (const signature of signatures) {
      registry.register(signature);
    }
  }

  return registry;
}

// ============================================================================
// Type Import Extraction
// ============================================================================
/**
 * Descriptor shape for type extraction functions.
 * Only requires the fields used for type imports and metadata.
 */
interface DescriptorWithTypes {
  readonly id: string;
  readonly types?: {
    readonly codecTypes?: {
      readonly import?: TypesImportSpec;
      readonly parameterized?: Record<string, TypeRenderer>;
      readonly typeImports?: ReadonlyArray<TypesImportSpec>;
    };
    readonly operationTypes?: { readonly import: TypesImportSpec };
  };
}

/**
 * Extracts codec type imports from descriptors for contract.d.ts generation.
 */
export function extractCodecTypeImports(
  descriptors: ReadonlyArray<DescriptorWithTypes>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const codecTypes = types?.codecTypes;
    if (codecTypes?.import) {
      imports.push(codecTypes.import);
    }
    if (codecTypes?.typeImports) {
      imports.push(...codecTypes.typeImports);
    }
  }

  return imports;
}

/**
 * Extracts operation type imports from descriptors for contract.d.ts generation.
 */
export function extractOperationTypeImports(
  descriptors: ReadonlyArray<DescriptorWithTypes>,
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

// ============================================================================
// Extension ID Extraction
// ============================================================================
/**
 * Extracts extension IDs from descriptors in deterministic order:
 * [adapter.id, target.id, ...extensions.map(e => e.id)]
 * Deduplicates while preserving stable order.
 */
export function extractExtensionIds(
  adapter: { readonly id: string },
  target: { readonly id: string },
  extensions: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();

  // Add adapter first
  addUniqueId(ids, seen, adapter.id);

  // Add target second
  addUniqueId(ids, seen, target.id);

  // Add extensions in order
  for (const ext of extensions) {
    addUniqueId(ids, seen, ext.id);
  }

  return ids;
}

// ============================================================================
// Parameterized Renderers
// ============================================================================
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
  descriptors: ReadonlyArray<DescriptorWithTypes>,
): Map<string, NormalizedTypeRenderer> {
  const renderers = new Map<string, NormalizedTypeRenderer>();
  // Codec owner: the single descriptor allowed to define a codecId renderer or hooks.
  const owners = new Map<string, string>(); // codecId -> descriptor.id for error messages

  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    if (!codecTypes?.parameterized) continue;

    const parameterized: Record<string, TypeRenderer> = codecTypes.parameterized;
    for (const [codecId, renderer] of Object.entries(parameterized)) {
      assertUniqueCodecOwner({
        codecId,
        owners,
        descriptorId: descriptor.id,
        entityLabel: 'parameterized renderer',
        entityOwnershipLabel: 'renderer',
      });
      renderers.set(codecId, normalizeRenderer(codecId, renderer));
      owners.set(codecId, descriptor.id);
    }
  }

  return renderers;
}

type CodecControlHooksMap = Record<string, CodecControlHooks>;

/**
 * Type guard to check if a descriptor has codec control plane hooks.
 * Returns true if descriptor.types.codecTypes.controlPlaneHooks is a non-null object.
 *
 * @param descriptor - Component descriptor to check (adapter, target, or extension)
 * @returns True if the descriptor has control plane hooks attached
 */
function hasCodecControlHooks(descriptor: unknown): descriptor is {
  readonly id: string;
  readonly types: {
    readonly codecTypes: {
      readonly controlPlaneHooks: CodecControlHooksMap;
    };
  };
} {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }
  const d = descriptor as { types?: { codecTypes?: { controlPlaneHooks?: unknown } } };
  const hooks = d.types?.codecTypes?.controlPlaneHooks;
  return hooks !== null && hooks !== undefined && typeof hooks === 'object';
}

// ============================================================================
// Codec Control Hooks
// ============================================================================
/**
 * Extracts codec control hooks from descriptors.
 *
 * Throws an error if multiple descriptors provide hooks for the same codecId.
 */
export function extractCodecControlHooks(
  descriptors: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): Map<string, CodecControlHooks> {
  const hooks = new Map<string, CodecControlHooks>();
  // Codec owner: the single descriptor allowed to define a codecId renderer or hooks.
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    if (typeof descriptor !== 'object' || descriptor === null) {
      continue;
    }
    if (!hasCodecControlHooks(descriptor)) {
      continue;
    }
    const controlPlaneHooks = descriptor.types.codecTypes.controlPlaneHooks;
    for (const [codecId, hook] of Object.entries(controlPlaneHooks)) {
      assertUniqueCodecOwner({
        codecId,
        owners,
        descriptorId: descriptor.id,
        entityLabel: 'control hooks',
        entityOwnershipLabel: 'owner',
      });
      hooks.set(codecId, hook);
      owners.set(codecId, descriptor.id);
    }
  }

  return hooks;
}

/**
 * Extracts parameterized type imports from descriptors for contract.d.ts generation.
 * These are type imports needed by parameterized codec renderers.
 *
 * @returns Array of type import specs (may contain duplicates; caller should deduplicate)
 */
export function extractParameterizedTypeImports(
  descriptors: ReadonlyArray<DescriptorWithTypes>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const typeImports = descriptor.types?.codecTypes?.typeImports;
    if (typeImports) {
      imports.push(...typeImports);
    }
  }

  return imports;
}
