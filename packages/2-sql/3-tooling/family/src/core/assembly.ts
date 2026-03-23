import type {
  NormalizedTypeRenderer,
  TargetBoundComponentDescriptor,
  TypeRenderer,
} from '@prisma-next/contract/framework-components';
import { normalizeRenderer } from '@prisma-next/contract/framework-components';
import type { TypesImportSpec } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import type {
  CodecControlHooks,
  ControlMutationDefaultFunctionEntry,
  ControlMutationDefaultGeneratorDescriptor,
  PslScalarTypeDescriptor,
  SqlControlStaticContributions,
} from './migrations/types';

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

export interface AssembledControlMutationDefaultContributions {
  readonly defaultFunctionRegistry: ReadonlyMap<string, ControlMutationDefaultFunctionEntry>;
  readonly generatorDescriptors: readonly ControlMutationDefaultGeneratorDescriptor[];
}

export interface AssembledPslInterpretationContributions
  extends AssembledControlMutationDefaultContributions {
  readonly scalarTypeDescriptors: ReadonlyMap<string, PslScalarTypeDescriptor>;
}

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

export function extractExtensionIds(
  adapter: { readonly id: string },
  target: { readonly id: string },
  extensions: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();

  addUniqueId(ids, seen, adapter.id);
  addUniqueId(ids, seen, target.id);

  for (const ext of extensions) {
    addUniqueId(ids, seen, ext.id);
  }

  return ids;
}

export function extractParameterizedRenderers(
  descriptors: ReadonlyArray<DescriptorWithTypes>,
): Map<string, NormalizedTypeRenderer> {
  const renderers = new Map<string, NormalizedTypeRenderer>();
  const owners = new Map<string, string>();

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

export function extractCodecControlHooks(
  descriptors: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): Map<string, CodecControlHooks> {
  const hooks = new Map<string, CodecControlHooks>();
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

export function assembleControlMutationDefaultContributions(
  descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>,
): AssembledControlMutationDefaultContributions {
  const defaultFunctionRegistry = new Map<string, ControlMutationDefaultFunctionEntry>();
  const functionOwners = new Map<string, string>();
  const generatorMap = new Map<string, ControlMutationDefaultGeneratorDescriptor>();
  const generatorOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const contributions = descriptor.controlMutationDefaults?.();
    if (!contributions) {
      continue;
    }

    for (const generatorDescriptor of contributions.generatorDescriptors) {
      const owner = generatorOwners.get(generatorDescriptor.id);
      if (owner) {
        throw new Error(
          `Duplicate mutation default generator id "${generatorDescriptor.id}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      generatorMap.set(generatorDescriptor.id, generatorDescriptor);
      generatorOwners.set(generatorDescriptor.id, descriptor.id);
    }

    for (const [functionName, handler] of contributions.defaultFunctionRegistry) {
      const owner = functionOwners.get(functionName);
      if (owner) {
        throw new Error(
          `Duplicate mutation default function "${functionName}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      defaultFunctionRegistry.set(functionName, handler);
      functionOwners.set(functionName, descriptor.id);
    }
  }

  return {
    defaultFunctionRegistry,
    generatorDescriptors: Array.from(generatorMap.values()),
  };
}

export function assemblePslInterpretationContributions(
  descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>,
): AssembledPslInterpretationContributions {
  const mutationDefaults = assembleControlMutationDefaultContributions(descriptors);
  const scalarTypeDescriptors = new Map<string, PslScalarTypeDescriptor>();
  const scalarOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const pslTypeContributions = descriptor.pslTypeDescriptors?.();
    if (!pslTypeContributions) {
      continue;
    }

    for (const [typeName, scalarDescriptor] of pslTypeContributions.scalarTypeDescriptors) {
      const owner = scalarOwners.get(typeName);
      if (owner) {
        throw new Error(
          `Duplicate PSL scalar type descriptor "${typeName}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      scalarTypeDescriptors.set(typeName, scalarDescriptor);
      scalarOwners.set(typeName, descriptor.id);
    }
  }

  return {
    ...mutationDefaults,
    scalarTypeDescriptors,
  };
}
