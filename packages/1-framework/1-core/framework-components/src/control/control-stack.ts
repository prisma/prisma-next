import type { CodecLookup } from '../shared/codec-types';
import type {
  AuthoringContributions,
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '../shared/framework-authoring';
import {
  assertNoCrossRegistryCollisions,
  isAuthoringFieldPresetDescriptor,
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
        isAuthoringFieldPresetDescriptor,
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
      isAuthoringTypeConstructorDescriptor,
      'type',
    );
  }

  const fieldNamespace = field as AuthoringFieldNamespace;
  const typeNamespace = type as AuthoringTypeNamespace;
  assertNoCrossRegistryCollisions(typeNamespace, fieldNamespace);

  return {
    field: fieldNamespace,
    type: typeNamespace,
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

/**
 * Structural narrow of the legacy fields the codec instance still
 * physically carries while the runtime `Codec` interface narrowed to
 * id + behavior. SQL `mkCodec()` / Mongo `mongoCodec()` factories still
 * emit `targetTypes` (and SQL emits `renderOutputType`) on the runtime
 * object — the narrow reads what's there to populate
 * {@link CodecLookup.targetTypesFor} and
 * {@link CodecLookup.renderOutputTypeFor}. Replaced when every codec
 * ships a native descriptor (TML-2357 M2).
 */
type LegacyCodecInstanceMeta = {
  readonly targetTypes?: readonly string[];
  readonly meta?: import('../shared/codec-types').CodecMeta;
  readonly renderOutputType?: (params: Record<string, unknown>) => string | undefined;
};

export function extractCodecLookup(
  descriptors: ReadonlyArray<Pick<ComponentMetadata & { id?: string }, 'types' | 'id'>>,
): CodecLookup {
  const byId = new Map<string, import('../shared/codec-types').Codec>();
  const targetTypesById = new Map<string, readonly string[]>();
  const metaById = new Map<string, import('../shared/codec-types').CodecMeta>();
  const renderersById = new Map<string, (params: Record<string, unknown>) => string | undefined>();
  const owners = new Map<string, string>();
  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    const descriptorId = descriptor.id ?? '<unknown>';
    // Descriptor-side metadata is the source of truth for `targetTypes`
    // / `meta` / `renderOutputType` (TML-2357 M2 Phase B). The codec-
    // instance fallback below stays for contributors that still
    // populate only `codecInstances`; it retires alongside the family-
    // `Codec` extensions' transitional fields once every contributor
    // exposes `codecDescriptors`.
    const seenIds = new Set<string>();
    for (const defineCodec of codecTypes?.codecDescriptors ?? []) {
      assertUniqueCodecOwner({
        codecId: defineCodec.codecId,
        owners,
        descriptorId,
        entityLabel: 'codec descriptor',
        entityOwnershipLabel: 'codec descriptor provider',
      });
      owners.set(defineCodec.codecId, descriptorId);
      seenIds.add(defineCodec.codecId);
      if (Array.isArray(defineCodec.targetTypes)) {
        targetTypesById.set(defineCodec.codecId, defineCodec.targetTypes);
      }
      if (defineCodec.meta !== undefined) {
        metaById.set(defineCodec.codecId, defineCodec.meta);
      }
      if (typeof defineCodec.renderOutputType === 'function') {
        renderersById.set(defineCodec.codecId, defineCodec.renderOutputType);
      }
      // Materialize a representative `Codec` instance for `byId.get()`
      // so consumers reading the lookup's instance side (e.g. SQL
      // renderer's cast-policy lookup) keep finding the codec.
      // Descriptors whose factory needs concrete params raise — those
      // are populated lazily by `buildContractCodecRegistry` at runtime.
      if (!byId.has(defineCodec.codecId)) {
        try {
          const representative = defineCodec.factory(undefined as never)({
            name: `<lookup:${defineCodec.codecId}>`,
          } as Parameters<ReturnType<typeof defineCodec.factory>>[0]);
          byId.set(defineCodec.codecId, representative);
        } catch {
          // Parameterized factory needs real params; leave `byId.get()`
          // returning `undefined` for this codec id.
        }
      }
    }
    for (const codec of codecTypes?.codecInstances ?? []) {
      if (!seenIds.has(codec.id)) {
        assertUniqueCodecOwner({
          codecId: codec.id,
          owners,
          descriptorId,
          entityLabel: 'codec instance',
          entityOwnershipLabel: 'codec instance provider',
        });
        owners.set(codec.id, descriptorId);
      }
      byId.set(codec.id, codec);
      // Legacy bolt-on read for contributors that haven't migrated to
      // `codecDescriptors`. Retires once every consumer ships the
      // descriptor list on `types.codecTypes.codecDescriptors`.
      const legacyMeta = codec as unknown as LegacyCodecInstanceMeta;
      if (!targetTypesById.has(codec.id) && Array.isArray(legacyMeta.targetTypes)) {
        targetTypesById.set(codec.id, legacyMeta.targetTypes);
      }
      if (!metaById.has(codec.id) && legacyMeta.meta !== undefined) {
        metaById.set(codec.id, legacyMeta.meta);
      }
      if (!renderersById.has(codec.id) && typeof legacyMeta.renderOutputType === 'function') {
        renderersById.set(codec.id, legacyMeta.renderOutputType);
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

export function createControlStack<TFamilyId extends string, TTargetId extends string>(
  input: CreateControlStackInput<TFamilyId, TTargetId>,
): ControlStack<TFamilyId, TTargetId> {
  const { family, target, adapter, driver, extensionPacks = [] } = input;

  const allDescriptors = [family, target, ...(adapter ? [adapter] : []), ...extensionPacks];

  const codecLookup = extractCodecLookup(allDescriptors);
  const scalarTypeDescriptors = assembleScalarTypeDescriptors(allDescriptors);

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
    scalarTypeDescriptors,
    controlMutationDefaults: assembleControlMutationDefaults(allDescriptors),
  };
}
