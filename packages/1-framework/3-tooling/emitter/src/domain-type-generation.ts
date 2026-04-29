import type {
  ContractField,
  ContractModel,
  ContractValueObject,
} from '@prisma-next/contract/types';
import type {
  CodecLookup,
  ParameterizedCodecDescriptorLookup,
} from '@prisma-next/framework-components/codec';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { isSafeTypeExpression } from './type-expression-safety';

export function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `'${escaped}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => serializeValue(v)).join(', ');
    return `readonly [${items}]`;
  }
  if (typeof value === 'object') {
    const entries: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      entries.push(`readonly ${serializeObjectKey(k)}: ${serializeValue(v)}`);
    }
    return `{ ${entries.join('; ')} }`;
  }
  return 'unknown';
}

export function serializeObjectKey(key: string): string {
  if (/^[$A-Z_a-z][$\w]*$/.test(key)) {
    return key;
  }
  return serializeValue(key);
}

export function generateRootsType(roots: Record<string, string> | undefined): string {
  if (!roots || Object.keys(roots).length === 0) {
    return 'Record<string, string>';
  }
  const entries = Object.entries(roots)
    .map(([key, value]) => `readonly ${serializeObjectKey(key)}: ${serializeValue(value)}`)
    .join('; ');
  return `{ ${entries} }`;
}

function contractFieldModifierSuffix(field: ContractField): string {
  const many = field.many === true ? '; readonly many: true' : '';
  const dict = field.dict === true ? '; readonly dict: true' : '';
  return many + dict;
}

export function generateModelFieldEntry(fieldName: string, field: ContractField): string {
  const mods = contractFieldModifierSuffix(field);
  const { nullable, type } = field;
  if (type.kind === 'scalar') {
    const typeParamsSpec =
      type.typeParams && Object.keys(type.typeParams).length > 0
        ? `; readonly typeParams: ${serializeValue(type.typeParams)}`
        : '';
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: { readonly kind: 'scalar'; readonly codecId: ${serializeValue(type.codecId)}${typeParamsSpec} }${mods} }`;
  }
  if (type.kind === 'valueObject') {
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: { readonly kind: 'valueObject'; readonly name: ${serializeValue(type.name)} }${mods} }`;
  }
  return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: ${serializeValue(type)}${mods} }`;
}

export function generateModelFieldsType(fields: Record<string, ContractField>): string {
  const fieldEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    fieldEntries.push(generateModelFieldEntry(fieldName, field));
  }
  return fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
}

export function generateModelRelationsType(relations: Record<string, unknown>): string {
  const relationEntries: string[] = [];

  for (const [relName, rel] of Object.entries(relations)) {
    if (typeof rel !== 'object' || rel === null) continue;
    const relObj = rel as Record<string, unknown>;
    const parts: string[] = [];

    if (relObj['to']) parts.push(`readonly to: ${serializeValue(relObj['to'])}`);
    if (relObj['cardinality'])
      parts.push(`readonly cardinality: ${serializeValue(relObj['cardinality'])}`);

    const on = relObj['on'] as { localFields?: string[]; targetFields?: string[] } | undefined;
    if (on && (!on.localFields || !on.targetFields)) {
      throw new Error(
        `Relation "${relName}" has an "on" block but is missing localFields or targetFields`,
      );
    }
    if (on?.localFields && on.targetFields) {
      const localFields = on.localFields.map((f) => serializeValue(f)).join(', ');
      const targetFields = on.targetFields.map((f) => serializeValue(f)).join(', ');
      parts.push(
        `readonly on: { readonly localFields: readonly [${localFields}]; readonly targetFields: readonly [${targetFields}] }`,
      );
    }

    if (parts.length > 0) {
      relationEntries.push(`readonly ${relName}: { ${parts.join('; ')} }`);
    }
  }

  if (relationEntries.length === 0) {
    return 'Record<string, never>';
  }

  return `{ ${relationEntries.join('; ')} }`;
}

export function generateModelsType(
  models: Record<string, ContractModel>,
  generateModelStorage: (modelName: string, model: ContractModel) => string,
): string {
  if (!models || Object.keys(models).length === 0) {
    return 'Record<string, never>';
  }

  const modelTypes: string[] = [];
  for (const [modelName, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    const fieldsType = generateModelFieldsType(model.fields);
    const relationsType = generateModelRelationsType(model.relations);
    const storageType = generateModelStorage(modelName, model);

    const modelParts: string[] = [
      `readonly fields: ${fieldsType}`,
      `readonly relations: ${relationsType}`,
      `readonly storage: ${storageType}`,
    ];

    if (model.owner) {
      modelParts.push(`readonly owner: ${serializeValue(model.owner)}`);
    }
    if (model.discriminator) {
      modelParts.push(`readonly discriminator: ${serializeValue(model.discriminator)}`);
    }
    if (model.variants) {
      modelParts.push(`readonly variants: ${serializeValue(model.variants)}`);
    }
    if (model.base) {
      modelParts.push(`readonly base: ${serializeValue(model.base)}`);
    }

    modelTypes.push(`readonly ${modelName}: { ${modelParts.join('; ')} }`);
  }

  return `{ ${modelTypes.join('; ')} }`;
}

export function deduplicateImports(imports: TypesImportSpec[]): TypesImportSpec[] {
  const seenKeys = new Set<string>();
  const result: TypesImportSpec[] = [];
  for (const imp of imports) {
    const key = `${imp.package}::${imp.named}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(imp);
    }
  }
  return result;
}

export function generateImportLines(imports: TypesImportSpec[]): string[] {
  return imports.map((imp) => {
    const importClause = imp.named === imp.alias ? imp.named : `${imp.named} as ${imp.alias}`;
    return `import type { ${importClause} } from '${imp.package}';`;
  });
}

export function generateCodecTypeIntersection(
  imports: ReadonlyArray<TypesImportSpec>,
  named: string,
): string {
  const aliases = imports.filter((imp) => imp.named === named).map((imp) => imp.alias);
  return aliases.join(' & ') || 'Record<string, never>';
}

export function serializeExecutionType(execution: Record<string, unknown>): string {
  const parts: string[] = ['readonly executionHash: ExecutionHash'];
  for (const [key, value] of Object.entries(execution)) {
    if (key === 'executionHash') continue;
    parts.push(`readonly ${serializeObjectKey(key)}: ${serializeValue(value)}`);
  }
  return `{ ${parts.join('; ')} }`;
}

export function generateHashTypeAliases(hashes: {
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}): string {
  const executionHashType = hashes.executionHash
    ? `ExecutionHashBase<'${hashes.executionHash}'>`
    : 'ExecutionHashBase<string>';

  return [
    `export type StorageHash = StorageHashBase<'${hashes.storageHash}'>;`,
    `export type ExecutionHash = ${executionHashType};`,
    `export type ProfileHash = ProfileHashBase<'${hashes.profileHash}'>;`,
  ].join('\n');
}

export type ResolvedFieldType = { readonly input: string; readonly output: string };

function applyModifiers(base: string, field: ContractField): string {
  let result = base;
  if (field.many === true) result = `ReadonlyArray<${result}>`;
  if (field.dict === true) result = `Readonly<Record<string, ${result}>>`;
  if (field.nullable) result = `${result} | null`;
  return result;
}

export function resolveFieldType(
  field: ContractField,
  // `_codecLookup` is unused now that the descriptor lookup is the sole emit-
  // path source of `renderOutputType` (the codec-object hook was retired in
  // favour of `ParameterizedCodecDescriptor.renderOutputType`; see ADR 205).
  // Kept in the signature so downstream callers don't need to thread a new
  // tuple of arguments.
  _codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
  // Pre-resolved typeParams supplied by the caller for fields whose
  // typeParams live on a named `storage.types` entry (referenced via a
  // family-specific `typeRef` on the storage column) rather than inline on
  // the domain field. The framework `ContractField` IR doesn't carry
  // `typeRef`, so the per-family emitter (`EmissionSpi.resolveFieldTypeParams`)
  // computes this at the iteration boundary and passes it in here. Inline
  // `field.type.typeParams` on the domain field takes precedence; the
  // overlay is consulted only when the domain field has no typeParams.
  resolvedTypeParams?: Record<string, unknown>,
): ResolvedFieldType {
  const { type } = field;

  switch (type.kind) {
    case 'scalar': {
      let outputResolved: string | undefined;
      const effectiveTypeParams =
        type.typeParams && Object.keys(type.typeParams).length > 0
          ? type.typeParams
          : resolvedTypeParams;
      if (effectiveTypeParams && Object.keys(effectiveTypeParams).length > 0) {
        // The framework-blessed `renderOutputType` lives on
        // `ParameterizedCodecDescriptor`. The codec-object hook is gone; the
        // descriptor lookup is the sole source of the emit-path renderer.
        // See ADR 205.
        const descriptor = parameterizedCodecLookup?.get(type.codecId);
        if (descriptor?.renderOutputType) {
          const rendered = descriptor.renderOutputType(effectiveTypeParams);
          if (rendered && isSafeTypeExpression(rendered)) {
            outputResolved = rendered;
          }
        }
      }
      const codecAccessor = `CodecTypes[${serializeValue(type.codecId)}]`;
      return {
        output: applyModifiers(outputResolved ?? `${codecAccessor}['output']`, field),
        input: applyModifiers(`${codecAccessor}['input']`, field),
      };
    }
    case 'valueObject':
      return {
        output: applyModifiers(`${type.name}Output`, field),
        input: applyModifiers(`${type.name}Input`, field),
      };
    case 'union': {
      const outputMembers = type.members.map((m) =>
        m.kind === 'scalar'
          ? `CodecTypes[${serializeValue(m.codecId)}]['output']`
          : `${m.name}Output`,
      );
      const inputMembers = type.members.map((m) =>
        m.kind === 'scalar'
          ? `CodecTypes[${serializeValue(m.codecId)}]['input']`
          : `${m.name}Input`,
      );
      return {
        output: applyModifiers(outputMembers.join(' | '), field),
        input: applyModifiers(inputMembers.join(' | '), field),
      };
    }
    default:
      return {
        output: applyModifiers('unknown', field),
        input: applyModifiers('unknown', field),
      };
  }
}

/**
 * Per-family resolver for typeParams that don't live inline on the domain
 * `ContractField`. SQL columns authored via a named `storage.types` entry
 * carry their `typeRef` on the storage column (family-specific) rather than
 * on the framework's domain field; the per-family emitter walks
 * `storage.types[ref].typeParams` here so the framework emit path can render
 * the parameterized output type.
 *
 * Returns `undefined` if the field has no typeParams worth resolving (i.e.
 * the column isn't parameterized, isn't a typeRef, or the family doesn't
 * support named storage types).
 */
export type FieldTypeParamsResolver = (
  modelName: string,
  fieldName: string,
) => Record<string, unknown> | undefined;

export function generateFieldResolvedType(
  field: ContractField,
  codecLookup?: CodecLookup,
  side: 'input' | 'output' = 'output',
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
): string {
  return resolveFieldType(field, codecLookup, parameterizedCodecLookup)[side];
}

export function generateBothFieldTypesMaps(
  models: Record<string, ContractModel> | undefined,
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
): ResolvedFieldType {
  if (!models || Object.keys(models).length === 0) {
    return { output: 'Record<string, never>', input: 'Record<string, never>' };
  }

  const outputModelEntries: string[] = [];
  const inputModelEntries: string[] = [];
  for (const [modelName, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    if (!model) continue;
    const outputFieldEntries: string[] = [];
    const inputFieldEntries: string[] = [];
    for (const [fieldName, field] of Object.entries(model.fields)) {
      // Inline `field.type.typeParams` is the IR's self-contained shape and
      // takes precedence; only consult the family resolver when the domain
      // field has no typeParams (the typeRef case).
      const inlineTypeParams =
        field.type.kind === 'scalar' &&
        field.type.typeParams &&
        Object.keys(field.type.typeParams).length > 0
          ? field.type.typeParams
          : undefined;
      const resolvedTypeParams = inlineTypeParams ?? resolveFieldTypeParams?.(modelName, fieldName);
      const resolved = resolveFieldType(
        field,
        codecLookup,
        parameterizedCodecLookup,
        resolvedTypeParams,
      );
      const key = `readonly ${serializeObjectKey(fieldName)}`;
      outputFieldEntries.push(`${key}: ${resolved.output}`);
      inputFieldEntries.push(`${key}: ${resolved.input}`);
    }
    const outputFields =
      outputFieldEntries.length > 0
        ? `{ ${outputFieldEntries.join('; ')} }`
        : 'Record<string, never>';
    const inputFields =
      inputFieldEntries.length > 0
        ? `{ ${inputFieldEntries.join('; ')} }`
        : 'Record<string, never>';
    const modelKey = `readonly ${serializeObjectKey(modelName)}`;
    outputModelEntries.push(`${modelKey}: ${outputFields}`);
    inputModelEntries.push(`${modelKey}: ${inputFields}`);
  }

  return {
    output: `{ ${outputModelEntries.join('; ')} }`,
    input: `{ ${inputModelEntries.join('; ')} }`,
  };
}

export function generateFieldOutputTypesMap(
  models: Record<string, ContractModel> | undefined,
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
): string {
  return generateBothFieldTypesMaps(
    models,
    codecLookup,
    parameterizedCodecLookup,
    resolveFieldTypeParams,
  ).output;
}

export function generateFieldInputTypesMap(
  models: Record<string, ContractModel> | undefined,
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
): string {
  return generateBothFieldTypesMaps(
    models,
    codecLookup,
    parameterizedCodecLookup,
    resolveFieldTypeParams,
  ).input;
}

export function generateValueObjectType(
  _voName: string,
  vo: ContractValueObject,
  _valueObjects: Record<string, ContractValueObject>,
  side: 'input' | 'output' = 'output',
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
): string {
  return resolveValueObjectType(_voName, vo, _valueObjects, codecLookup, parameterizedCodecLookup)[
    side
  ];
}

export function resolveValueObjectType(
  _voName: string,
  vo: ContractValueObject,
  _valueObjects: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
): ResolvedFieldType {
  const outputEntries: string[] = [];
  const inputEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(vo.fields)) {
    const resolved = resolveFieldType(field, codecLookup, parameterizedCodecLookup);
    const key = `readonly ${serializeObjectKey(fieldName)}`;
    outputEntries.push(`${key}: ${resolved.output}`);
    inputEntries.push(`${key}: ${resolved.input}`);
  }
  const empty = 'Record<string, never>';
  return {
    output: outputEntries.length > 0 ? `{ ${outputEntries.join('; ')} }` : empty,
    input: inputEntries.length > 0 ? `{ ${inputEntries.join('; ')} }` : empty,
  };
}

export function generateContractFieldDescriptor(fieldName: string, field: ContractField): string {
  const mods: string[] = [];
  if (field.many === true) mods.push('; readonly many: true');
  if (field.dict === true) mods.push('; readonly dict: true');
  const modStr = mods.join('');

  const { type } = field;
  if (type.kind === 'scalar') {
    const typeParamsSpec =
      type.typeParams && Object.keys(type.typeParams).length > 0
        ? `; readonly typeParams: ${serializeValue(type.typeParams)}`
        : '';
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: { readonly kind: 'scalar'; readonly codecId: ${serializeValue(type.codecId)}${typeParamsSpec} }${modStr} }`;
  }
  if (type.kind === 'valueObject') {
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: { readonly kind: 'valueObject'; readonly name: ${serializeValue(type.name)} }${modStr} }`;
  }
  return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: ${serializeValue(type)}${modStr} }`;
}

export function generateValueObjectsDescriptorType(
  valueObjects: Record<string, ContractValueObject> | undefined,
): string {
  if (!valueObjects || Object.keys(valueObjects).length === 0) {
    return 'Record<string, never>';
  }

  const voEntries: string[] = [];
  for (const [voName, vo] of Object.entries(valueObjects)) {
    const fieldEntries: string[] = [];
    for (const [fieldName, field] of Object.entries(vo.fields)) {
      fieldEntries.push(generateContractFieldDescriptor(fieldName, field));
    }
    const fieldsType =
      fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
    voEntries.push(`readonly ${serializeObjectKey(voName)}: { readonly fields: ${fieldsType} }`);
  }

  return `{ ${voEntries.join('; ')} }`;
}

export function generateValueObjectTypeAliases(
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup?: CodecLookup,
  parameterizedCodecLookup?: ParameterizedCodecDescriptorLookup,
): string {
  if (!valueObjects || Object.keys(valueObjects).length === 0) {
    return '';
  }

  const aliases: string[] = [];
  for (const [voName, vo] of Object.entries(valueObjects)) {
    const resolved = resolveValueObjectType(
      voName,
      vo,
      valueObjects,
      codecLookup,
      parameterizedCodecLookup,
    );
    aliases.push(`export type ${voName}Output = ${resolved.output};`);
    aliases.push(`export type ${voName}Input = ${resolved.input};`);
  }
  return aliases.join('\n');
}
