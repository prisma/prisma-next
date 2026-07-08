import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { FieldSymbol, InterpretCtx, ModelSymbol } from '@prisma-next/psl-parser';
import {
  fieldAttribute,
  fieldRef,
  interpretAttribute,
  list,
  modelAttribute,
  optional,
  str,
} from '@prisma-next/psl-parser';
import type {
  FieldAttributeAst,
  ModelAttributeAst,
  SourceFile,
} from '@prisma-next/psl-parser/syntax';

export function findModelAttributeNode(
  model: ModelSymbol,
  name: string,
): ModelAttributeAst | undefined {
  for (const attribute of model.node.attributes()) {
    if (attribute.name()?.path().join('.') === name) return attribute;
  }
  return undefined;
}

export function findFieldAttributeNode(
  field: FieldSymbol,
  name: string,
): FieldAttributeAst | undefined {
  for (const attribute of field.node.attributes()) {
    if (attribute.name()?.path().join('.') === name) return attribute;
  }
  return undefined;
}

export function buildModelInterpretCtx(input: {
  readonly selfModel: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}): InterpretCtx {
  return {
    level: 'model',
    sourceId: input.sourceId,
    sourceFile: input.sourceFile,
    selfModel: input.selfModel,
    resolveReferencedModel: () => undefined,
  };
}

export function buildFieldInterpretCtx(input: {
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}): InterpretCtx {
  return {
    level: 'field',
    sourceId: input.sourceId,
    sourceFile: input.sourceFile,
    selfModel: input.selfModel,
    resolveReferencedModel: () => undefined,
    field: input.field,
  };
}

const mapModelSpec = modelAttribute('map', { positional: [{ key: 'name', type: str() }] });
const mapFieldSpec = fieldAttribute('map', { positional: [{ key: 'name', type: str() }] });

// `@@map` / `@map` are optional: an absent attribute falls back to the caller's
// default (lowered model name / field name).
export function interpretModelMapName(input: {
  readonly model: ModelSymbol;
  readonly defaultValue: string;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string {
  const node = findModelAttributeNode(input.model, 'map');
  if (node === undefined) return input.defaultValue;
  const result = interpretAttribute(
    node,
    mapModelSpec,
    buildModelInterpretCtx({
      selfModel: input.model,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return input.defaultValue;
  }
  return result.value.name;
}

const idFieldSpec = fieldAttribute('id', { named: { map: optional(str()) } });
const uniqueFieldSpec = fieldAttribute('unique', { named: { map: optional(str()) } });

const idModelSpec = modelAttribute('id', {
  positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }],
  named: { map: optional(str()) },
});
const uniqueModelSpec = modelAttribute('unique', {
  positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }],
  named: { map: optional(str()) },
});

// `@id` / `@unique` carry an optional constraint `map:` name; the caller detects
// presence separately, so an absent attribute simply yields no name.
export function interpretFieldConstraintMapName(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly attributeName: 'id' | 'unique';
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string | undefined {
  const node = findFieldAttributeNode(input.field, input.attributeName);
  if (node === undefined) return undefined;
  const spec = input.attributeName === 'id' ? idFieldSpec : uniqueFieldSpec;
  const result = interpretAttribute(
    node,
    spec,
    buildFieldInterpretCtx({
      selfModel: input.model,
      field: input.field,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return undefined;
  }
  return result.value.map;
}

// `@@id` / `@@unique` share an argument shape: a required field list plus an
// optional constraint `map:` name. Semantic checks (nullable-in-PK, column
// mapping, both-inline-and-block PK, duplicate declaration) stay in the caller.
export function interpretModelConstraint(input: {
  readonly node: ModelAttributeAst;
  readonly attributeName: 'id' | 'unique';
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): { readonly fields: readonly string[]; readonly map: string | undefined } | undefined {
  const spec = input.attributeName === 'id' ? idModelSpec : uniqueModelSpec;
  const result = interpretAttribute(
    input.node,
    spec,
    buildModelInterpretCtx({
      selfModel: input.model,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return undefined;
  }
  return { fields: result.value.fields, map: result.value.map };
}

export function interpretFieldMapName(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly defaultValue: string;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string {
  const node = findFieldAttributeNode(input.field, 'map');
  if (node === undefined) return input.defaultValue;
  const result = interpretAttribute(
    node,
    mapFieldSpec,
    buildFieldInterpretCtx({
      selfModel: input.model,
      field: input.field,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return input.defaultValue;
  }
  return result.value.name;
}
