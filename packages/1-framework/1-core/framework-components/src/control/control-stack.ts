import { blindCast } from '@prisma-next/utils/casts';
import type { Codec } from '../shared/codec';
import type { CodecLookup, CodecMeta } from '../shared/codec-types';
import type {
  AuthoringContributions,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '../shared/framework-authoring';
import {
  assertNoCrossRegistryCollisions,
  isAuthoringEntityTypeDescriptor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringPslBlockDescriptor,
  isAuthoringTypeConstructorDescriptor,
  mergeAuthoringNamespaces,
} from '../shared/framework-authoring';
import type { ComponentMetadata } from '../shared/framework-components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from '../shared/mutation-default-types';
import type { TypesImportSpec } from '../shared/types-import-spec';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from './control-descriptors';

export interface AssembledAuthoringContributions {
  readonly field: AuthoringFieldNamespace;
  readonly type: AuthoringTypeNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
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
  readonly queryOperationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly codecLookup: CodecLookup;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly scalarTypeDescriptors: ReadonlyMap<string, string>;
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

export function assembleAuthoringContributions(
  descriptors: ReadonlyArray<{ readonly authoring?: AuthoringContributions }>,
): AssembledAuthoringContributions {
  const field = {} as Record<string, unknown>;
  const type = {} as Record<string, unknown>;
  const entityTypes = {} as Record<string, unknown>;
  const pslBlockDescriptors: Record<string, unknown> = {};

  for (const descriptor of descriptors) {
    if (descriptor.authoring?.field) {
      mergeAuthoringNamespaces(
        field,
        descriptor.authoring.field,
        [],
        isAuthoringFieldPresetDescriptor,
        'field',
      );
    }
    if (descriptor.authoring?.type) {
      mergeAuthoringNamespaces(
        type,
        descriptor.authoring.type,
        [],
        isAuthoringTypeConstructorDescriptor,
        'type',
      );
    }
    if (descriptor.authoring?.entityTypes) {
      mergeAuthoringNamespaces(
        entityTypes,
        descriptor.authoring.entityTypes,
        [],
        isAuthoringEntityTypeDescriptor,
        'entity',
      );
    }
    if (descriptor.authoring?.pslBlockDescriptors) {
      mergeAuthoringNamespaces(
        pslBlockDescriptors,
        descriptor.authoring.pslBlockDescriptors,
        [],
        isAuthoringPslBlockDescriptor,
        'pslBlock',
      );
    }
  }

  const fieldNamespace = field as AuthoringFieldNamespace;
  const typeNamespace = type as AuthoringTypeNamespace;
  const entityTypeNamespace = entityTypes as AuthoringEntityTypeNamespace;
  const pslBlockDescriptorNamespace = blindCast<
    AuthoringPslBlockDescriptorNamespace,
    'merge target accumulator narrows to typed namespace post-merge'
  >(pslBlockDescriptors);
  assertNoCrossRegistryCollisions(
    typeNamespace,
    fieldNamespace,
    entityTypeNamespace,
    pslBlockDescriptorNamespace,
  );

  return {
    field: fieldNamespace,
    type: typeNamespace,
    entityTypes: entityTypeNamespace,
    pslBlockDescriptors: pslBlockDescriptorNamespace,
  };
}

export function assembleScalarTypeDescriptors(
  descriptors: ReadonlyArray<
    Pick<ComponentMetadata, 'scalarTypeDescriptors'> & { readonly id?: string }
  >,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const descriptorMap = descriptor.scalarTypeDescriptors;
    if (!descriptorMap) continue;
    const descriptorId = descriptor.id ?? '<unknown>';
    for (const [typeName, codecId] of descriptorMap) {
      const existingOwner = owners.get(typeName);
      if (existingOwner !== undefined) {
        throw new Error(
          `Duplicate scalar type descriptor "${typeName}". ` +
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
  descriptors: ReadonlyArray<Pick<ComponentMetadata & { id: string }, 'types' | 'id'>>,
): CodecLookup {
  const byId = new Map<string, Codec>();
  const targetTypesById = new Map<string, readonly string[]>();
  const metaById = new Map<string, CodecMeta>();
  const renderersById = new Map<string, (params: Record<string, unknown>) => string | undefined>();
  const owners = new Map<string, string>();
  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    const descriptorId = descriptor.id;
    // Descriptor-side metadata is the single source of truth for `targetTypes` / `meta` / `renderOutputType`. Every contributor ships a `codecDescriptors` list on `types.codecTypes`.
    for (const codecDescriptor of codecTypes?.codecDescriptors ?? []) {
      assertUniqueCodecOwner({
        codecId: codecDescriptor.codecId,
        owners,
        descriptorId,
        entityLabel: 'codec descriptor',
        entityOwnershipLabel: 'codec descriptor provider',
      });
      owners.set(codecDescriptor.codecId, descriptorId);
      if (Array.isArray(codecDescriptor.targetTypes)) {
        targetTypesById.set(codecDescriptor.codecId, codecDescriptor.targetTypes);
      }
      if (codecDescriptor.meta !== undefined) {
        metaById.set(codecDescriptor.codecId, codecDescriptor.meta);
      }
      if (typeof codecDescriptor.renderOutputType === 'function') {
        renderersById.set(codecDescriptor.codecId, codecDescriptor.renderOutputType);
      }
      // Materialize a representative `Codec` instance for `byId.get()` so consumers reading the lookup's instance side (e.g. SQL renderer's cast-policy lookup, or the contract emitter's literal-default `encodeJson` resolver) keep finding the codec.
      //
      // Two cohorts:
      // - Non-parameterized descriptors: factory must succeed; any throw is a real bug and we let it propagate (no silent try/catch).
      // - Parameterized descriptors: try with empty params. Many parameterized codecs treat params as advisory (e.g. `pg/timestamptz@1` whose precision is rendered into the `nativeType` only and never read by the runtime codec), so an empty-params construction yields a usable representative for id-keyed lookups (e.g. emit-time literal-default encoding). Codecs whose factory genuinely requires params (e.g. `pg/vector@1` threading `length` into the runtime codec) will throw; for those, per-column instances are materialized at runtime by `buildContractCodecRegistry` and the id-keyed lookup miss is correct (the column-aware path resolves them).
      if (!byId.has(codecDescriptor.codecId)) {
        if (codecDescriptor.isParameterized) {
          try {
            const representative = codecDescriptor.factory({} as never)({
              name: `<lookup:${codecDescriptor.codecId}>`,
            } as Parameters<ReturnType<typeof codecDescriptor.factory>>[0]);
            byId.set(codecDescriptor.codecId, representative);
          } catch {
            // Factory requires concrete params; skip representative materialization. Per-column instances are built at runtime; id-keyed lookup miss is the correct outcome here.
          }
        } else {
          const representative = codecDescriptor.factory(undefined as never)({
            name: `<lookup:${codecDescriptor.codecId}>`,
          } as Parameters<ReturnType<typeof codecDescriptor.factory>>[0]);
          byId.set(codecDescriptor.codecId, representative);
        }
      }
    }
  }
  return {
    get: (id) => byId.get(id),
    targetTypesFor: (id) => targetTypesById.get(id),
    metaFor: (id) => metaById.get(id),
    renderOutputTypeFor: (id, params) => renderersById.get(id)?.(params),
  };
}

export function validateScalarTypeCodecIds(
  scalarTypeDescriptors: ReadonlyMap<string, string>,
  codecLookup: CodecLookup,
): string[] {
  const errors: string[] = [];
  for (const [typeName, codecId] of scalarTypeDescriptors) {
    if (!codecLookup.get(codecId)) {
      errors.push(
        `Scalar type "${typeName}" references codec "${codecId}" which is not registered by any component.`,
      );
    }
  }
  return errors;
}

interface DependencyDeclaringDescriptor {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson?: {
      readonly extensionPacks?: Readonly<Record<string, unknown>>;
    };
  };
}

function readDeclaredDependencyIds(descriptor: DependencyDeclaringDescriptor): readonly string[] {
  const packs = descriptor.contractSpace?.contractJson?.extensionPacks;
  if (packs === null || typeof packs !== 'object') return [];
  return Object.keys(packs);
}

/**
 * Builds a dependency-respecting load order for the given extension descriptors
 * using Kahn's topological sort algorithm. Dependencies (packs declared in
 * `contractSpace.contractJson.extensionPacks`) are placed before the extensions
 * that depend on them.
 *
 * Throws if the dependency graph contains a cycle, with an error message that
 * names every extension involved in the cycle.
 *
 * Throws if any extension declares a dependency on a pack ID that is not present
 * in the provided list — add the missing pack to the `extensionPacks` list to
 * resolve the error.
 */

export function buildExtensionLoadOrder(
  extensions: ReadonlyArray<DependencyDeclaringDescriptor>,
): readonly string[] {
  if (extensions.length === 0) return [];

  const idSet = new Set(extensions.map((e) => e.id));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const ext of extensions) {
    if (!inDegree.has(ext.id)) inDegree.set(ext.id, 0);
    if (!dependents.has(ext.id)) dependents.set(ext.id, []);
  }

  for (const ext of extensions) {
    for (const depId of readDeclaredDependencyIds(ext)) {
      if (!idSet.has(depId)) {
        throw new Error(
          `Extension "${ext.id}" declares a dependency on "${depId}", but "${depId}" is not in the provided extension set. Add the missing space to extensionPacks.`,
        );
      }
      inDegree.set(ext.id, (inDegree.get(ext.id) ?? 0) + 1);
      const list = dependents.get(depId);
      if (list !== undefined) list.push(ext.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    result.push(id);
    const children = dependents.get(id) ?? [];
    children.sort();
    for (const childId of children) {
      const newDeg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, newDeg);
      if (newDeg === 0) queue.push(childId);
    }
  }

  if (result.length < extensions.length) {
    const cycleMembers = extensions
      .map((e) => e.id)
      .filter((id) => !result.includes(id))
      .sort();
    throw new Error(
      `Extension dependency cycle detected. Cycle members: ${cycleMembers.map((id) => `"${id}"`).join(', ')}.`,
    );
  }

  return result;
}

export function createControlStack<TFamilyId extends string, TTargetId extends string>(
  input: CreateControlStackInput<TFamilyId, TTargetId>,
): ControlStack<TFamilyId, TTargetId> {
  const { family, target, adapter, driver, extensionPacks = [] } = input;

  const orderedIds = buildExtensionLoadOrder(extensionPacks);
  const extensionById = new Map(extensionPacks.map((ext) => [ext.id, ext]));
  const orderedExtensionPacks = orderedIds
    .map((id) => extensionById.get(id))
    .filter((ext): ext is ControlExtensionDescriptor<TFamilyId, TTargetId> => ext !== undefined);

  const allDescriptors = [family, target, ...(adapter ? [adapter] : []), ...orderedExtensionPacks];

  const codecLookup = extractCodecLookup(allDescriptors);
  const scalarTypeDescriptors = assembleScalarTypeDescriptors(allDescriptors);

  return {
    family,
    target,
    adapter,
    driver,
    extensionPacks: orderedExtensionPacks,

    codecTypeImports: extractCodecTypeImports(allDescriptors),
    queryOperationTypeImports: extractQueryOperationTypeImports(allDescriptors),
    extensionIds: extractComponentIds(family, target, adapter, orderedExtensionPacks),
    codecLookup,
    authoringContributions: assembleAuthoringContributions(allDescriptors),
    scalarTypeDescriptors,
    controlMutationDefaults: assembleControlMutationDefaults(allDescriptors),
  };
}
