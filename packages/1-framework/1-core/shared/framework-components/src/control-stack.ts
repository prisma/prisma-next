import type {
  AuthoringContributions,
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from './framework-authoring';
import type { NormalizedTypeRenderer, TypeRenderer } from './type-renderers';
import { normalizeRenderer } from './type-renderers';
import type { TypesImportSpec } from './types';

export interface AssemblyInput {
  readonly id: string;
  readonly authoring?: AuthoringContributions;
  readonly types?: {
    readonly codecTypes?: {
      readonly import?: TypesImportSpec;
      readonly parameterized?: Record<string, TypeRenderer>;
      readonly typeImports?: ReadonlyArray<TypesImportSpec>;
    };
    readonly operationTypes?: { readonly import: TypesImportSpec };
    readonly queryOperationTypes?: { readonly import: TypesImportSpec };
  };
}

export interface AssembledAuthoringContributions {
  readonly field: AuthoringFieldNamespace;
  readonly type: AuthoringTypeNamespace;
}

export interface ControlStack {
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly parameterizedRenderers: Map<string, NormalizedTypeRenderer>;
  readonly parameterizedTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly authoringContributions: AssembledAuthoringContributions;
}

export interface CreateControlStackInput {
  readonly family: AssemblyInput;
  readonly target: AssemblyInput;
  readonly adapter?: AssemblyInput;
  readonly extensionPacks?: ReadonlyArray<AssemblyInput>;
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
  descriptors: ReadonlyArray<AssemblyInput>,
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
  descriptors: ReadonlyArray<AssemblyInput>,
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
  descriptors: ReadonlyArray<AssemblyInput>,
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

export function extractParameterizedRenderers(
  descriptors: ReadonlyArray<AssemblyInput>,
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

export function extractParameterizedTypeImports(
  descriptors: ReadonlyArray<AssemblyInput>,
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

export function createControlStack(input: CreateControlStackInput): ControlStack {
  const { family, target, adapter, extensionPacks = [] } = input;

  const allDescriptors: AssemblyInput[] = [family, target];
  if (adapter) allDescriptors.push(adapter);
  allDescriptors.push(...extensionPacks);

  return {
    codecTypeImports: extractCodecTypeImports(allDescriptors),
    operationTypeImports: extractOperationTypeImports(allDescriptors),
    queryOperationTypeImports: extractQueryOperationTypeImports(allDescriptors),
    extensionIds: extractComponentIds(family, target, adapter, extensionPacks),
    parameterizedRenderers: extractParameterizedRenderers(allDescriptors),
    parameterizedTypeImports: extractParameterizedTypeImports(allDescriptors),
    authoringContributions: assembleAuthoringContributions(allDescriptors),
  };
}
