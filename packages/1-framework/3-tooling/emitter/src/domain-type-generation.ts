import type { ContractModel } from '@prisma-next/contract/types';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';

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

export function generateModelFieldsType(
  fields: Record<string, { readonly codecId: string; readonly nullable: boolean }>,
): string {
  const fieldEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    fieldEntries.push(
      `readonly ${serializeObjectKey(fieldName)}: { readonly codecId: ${serializeValue(field.codecId)}; readonly nullable: ${field.nullable} }`,
    );
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
