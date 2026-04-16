import type { CodecLookup } from './codec-types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from './control-descriptors';
import type {
  AuthoringContributions,
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from './framework-authoring';
import type { ComponentMetadata } from './framework-components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from './mutation-default-types';
import type { TypesImportSpec } from './types-import-spec';

export interface AssembledAuthoringContributions {
  readonly field: AuthoringFieldNamespace;
  readonly type: AuthoringTypeNamespace;
}

export interface ControlStack<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter?: ControlAdapterDescriptor<TFamilyId, TTargetId> | undefined;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];

  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly codecLookup: CodecLookup;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly pslScalarTypeDescriptors: ReadonlyMap<string, string>;
  readonly controlMutationDefaults: ControlMutationDefaults;
}

export interface CreateControlStackInput<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter?: ControlAdapterDescriptor<TFamilyId, TTargetId> | undefined;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks?:
    | ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>
    | undefined;
}

function addUniqueId(ids: string[], seen: Set<string>, id: string): void {
  if (!seen.has(id)) {
    ids.push(id);
    seen.add(id);
  }
}

export function assertUniqueCodecOwner(options: {
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

export function extractCodecTypeImports(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
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
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const operationTypes = descriptor.types?.operationTypes;
    if (operationTypes?.import) {
      imports.push(operationTypes.import);
    }
  }

  return imports;
}

export function extractQueryOperationTypeImports(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const queryOperationTypes = descriptor.types?.queryOperationTypes;
    if (queryOperationTypes?.import) {
      imports.push(queryOperationTypes.import);
    }
  }

  return imports;
}

export function extractComponentIds(
  family: { readonly id: string },
  target: { readonly id: string },
  adapter: { readonly id: string } | undefined,
  extensions: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();

  addUniqueId(ids, seen, family.id);
  addUniqueId(ids, seen, target.id);
  if (adapter) {
    addUniqueId(ids, seen, adapter.id);
  }

  for (const ext of extensions) {
    addUniqueId(ids, seen, ext.id);
  }

  return ids;
}

function isTypeConstructorDescriptor(value: unknown): value is AuthoringTypeConstructorDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'typeConstructor'
  );
}

function isFieldPresetDescriptor(value: unknown): value is AuthoringFieldPresetDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'fieldPreset'
  );
}

function mergeAuthoringNamespaces(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: readonly string[],
  leafGuard: (value: unknown) => boolean,
  label: string,
): void {
  const assertSafePath = (currentPath: readonly string[]) => {
    const blockedSegment = currentPath.find(
      (segment) => segment === '__proto__' || segment === 'constructor' || segment === 'prototype',
    );
    if (blockedSegment) {
      throw new Error(
        `Invalid authoring ${label} helper "${currentPath.join('.')}". Helper path segments must not use "${blockedSegment}".`,
      );
    }
  };

  for (const [key, sourceValue] of Object.entries(source)) {
    const currentPath = [...path, key];
    assertSafePath(currentPath);
    const hasExistingValue = Object.hasOwn(target, key);
    const existingValue = hasExistingValue ? target[key] : undefined;

    if (!hasExistingValue) {
      target[key] = sourceValue;
      continue;
    }

    const existingIsLeaf = leafGuard(existingValue);
    const sourceIsLeaf = leafGuard(sourceValue);

    if (existingIsLeaf || sourceIsLeaf) {
      throw new Error(
        `Duplicate authoring ${label} helper "${currentPath.join('.')}". Descriptor contributions must be unique across composed components.`,
      );
    }

    mergeAuthoringNamespaces(
      existingValue as Record<string, unknown>,
      sourceValue as Record<string, unknown>,
      currentPath,
      leafGuard,
      label,
    );
  }
}

export function assembleAuthoringContributions(
  descriptors: ReadonlyArray<{ readonly authoring?: AuthoringContributions }>,
): AssembledAuthoringContributions {
  const field = {} as Record<string, unknown>;
  const type = {} as Record<string, unknown>;

  for (const descriptor of descriptors) {
    if (descriptor.authoring?.field) {
      mergeAuthoringNamespaces(
        field,
        descriptor.authoring.field,
        [],
        isFieldPresetDescriptor,
        'field',
      );
    }
    if (!descriptor.authoring?.type) {
      continue;
    }
    mergeAuthoringNamespaces(
      type,
      descriptor.authoring.type,
      [],
      isTypeConstructorDescriptor,
      'type',
    );
  }

  return {
    field: field as AuthoringFieldNamespace,
    type: type as AuthoringTypeNamespace,
  };
}

export function assemblePslScalarTypeDescriptors(
  descriptors: ReadonlyArray<
    Pick<ComponentMetadata, 'pslScalarTypeDescriptors'> & { readonly id?: string }
  >,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const descriptors_map = descriptor.pslScalarTypeDescriptors;
    if (!descriptors_map) continue;
    const descriptorId = descriptor.id ?? '<unknown>';
    for (const [typeName, codecId] of descriptors_map) {
      const existingOwner = owners.get(typeName);
      if (existingOwner !== undefined) {
        throw new Error(
          `Duplicate PSL scalar type descriptor "${typeName}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      result.set(typeName, codecId);
      owners.set(typeName, descriptorId);
    }
  }

  return result;
}

export function assembleControlMutationDefaults(
  descriptors: ReadonlyArray<
    Pick<ComponentMetadata, 'controlMutationDefaults'> & { readonly id?: string }
  >,
): ControlMutationDefaults {
  const defaultFunctionRegistry = new Map<string, ControlMutationDefaultEntry>();
  const functionOwners = new Map<string, string>();
  const generatorMap = new Map<string, MutationDefaultGeneratorDescriptor>();
  const generatorOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const contributions = descriptor.controlMutationDefaults;
    if (!contributions) continue;
    const descriptorId = descriptor.id ?? '<unknown>';

    for (const generatorDescriptor of contributions.generatorDescriptors) {
      const existingOwner = generatorOwners.get(generatorDescriptor.id);
      if (existingOwner !== undefined) {
        throw new Error(
          `Duplicate mutation default generator id "${generatorDescriptor.id}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      generatorMap.set(generatorDescriptor.id, generatorDescriptor);
      generatorOwners.set(generatorDescriptor.id, descriptorId);
    }

    for (const [functionName, handler] of contributions.defaultFunctionRegistry) {
      const existingOwner = functionOwners.get(functionName);
      if (existingOwner !== undefined) {
        throw new Error(
          `Duplicate mutation default function "${functionName}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      defaultFunctionRegistry.set(functionName, handler);
      functionOwners.set(functionName, descriptorId);
    }
  }

  return {
    defaultFunctionRegistry,
    generatorDescriptors: Array.from(generatorMap.values()),
  };
}

export function extractCodecLookup(
  descriptors: ReadonlyArray<Pick<ComponentMetadata & { id?: string }, 'types' | 'id'>>,
): CodecLookup {
  const byId = new Map<string, import('./codec-types').Codec>();
  const owners = new Map<string, string>();
  for (const descriptor of descriptors) {
    const codecInstances = descriptor.types?.codecTypes?.codecInstances;
    if (!codecInstances) continue;
    const descriptorId = descriptor.id ?? '<unknown>';
    for (const codec of codecInstances) {
      assertUniqueCodecOwner({
        codecId: codec.id,
        owners,
        descriptorId,
        entityLabel: 'codec instance',
        entityOwnershipLabel: 'codec instance provider',
      });
      owners.set(codec.id, descriptorId);
      byId.set(codec.id, codec);
    }
  }
  return { get: (id) => byId.get(id) };
}

export function validatePslScalarTypeCodecIds(
  pslScalarTypeDescriptors: ReadonlyMap<string, string>,
  codecLookup: CodecLookup,
): string[] {
  const errors: string[] = [];
  for (const [typeName, codecId] of pslScalarTypeDescriptors) {
    if (!codecLookup.get(codecId)) {
      errors.push(
        `PSL scalar type "${typeName}" references codec "${codecId}" which is not registered by any component.`,
      );
    }
  }
  return errors;
}

export function createControlStack<TFamilyId extends string, TTargetId extends string>(
  input: CreateControlStackInput<TFamilyId, TTargetId>,
): ControlStack<TFamilyId, TTargetId> {
  const { family, target, adapter, driver, extensionPacks = [] } = input;

  const allDescriptors = [family, target, ...(adapter ? [adapter] : []), ...extensionPacks];

  const codecLookup = extractCodecLookup(allDescriptors);
  const pslScalarTypeDescriptors = assemblePslScalarTypeDescriptors(allDescriptors);

  return {
    family,
    target,
    adapter,
    driver,
    extensionPacks: extensionPacks as readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[],

    codecTypeImports: extractCodecTypeImports(allDescriptors),
    operationTypeImports: extractOperationTypeImports(allDescriptors),
    queryOperationTypeImports: extractQueryOperationTypeImports(allDescriptors),
    extensionIds: extractComponentIds(family, target, adapter, extensionPacks),
    codecLookup,
    authoringContributions: assembleAuthoringContributions(allDescriptors),
    pslScalarTypeDescriptors,
    controlMutationDefaults: assembleControlMutationDefaults(allDescriptors),
  };
}
