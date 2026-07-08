import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ControlPolicy } from '@prisma-next/contract/types';
import type { FieldSymbol, InterpretCtx, ModelSymbol } from '@prisma-next/psl-parser';
import {
  fieldAttribute,
  fieldRef,
  identifier,
  interpretAttribute,
  leafDiagnostic,
  list,
  modelAttribute,
  oneOf,
  optional,
  record,
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

const indexModelSpec = modelAttribute('index', {
  positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }],
  named: { map: optional(str()), type: optional(str()), options: optional(record(str())) },
  refine: (value, ctx) =>
    value.options !== undefined && value.type === undefined
      ? [
          leafDiagnostic(
            ctx,
            ctx.selfModel.node,
            '`@@index` options argument requires a type argument',
          ),
        ]
      : [],
});

// `@@index` carries a required field list plus optional `map`/`type`/`options`.
// `options` is only meaningful alongside `type` (enforced by the spec's refine).
// Column mapping and duplicate-attribute checks stay in the caller.
export function interpretModelIndex(input: {
  readonly node: ModelAttributeAst;
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}):
  | {
      readonly fields: readonly string[];
      readonly map: string | undefined;
      readonly type: string | undefined;
      readonly options: Record<string, string> | undefined;
    }
  | undefined {
  const result = interpretAttribute(
    input.node,
    indexModelSpec,
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
  return {
    fields: result.value.fields,
    map: result.value.map,
    type: result.value.type,
    options: result.value.options,
  };
}

const controlModelSpec = modelAttribute('control', {
  positional: [
    {
      key: 'policy',
      type: oneOf(
        identifier('managed'),
        identifier('tolerated'),
        identifier('external'),
        identifier('observed'),
      ),
    },
  ],
});

// `@@control` carries a single bare-identifier policy word. The duplicate-`@@control`
// guard stays in the caller; this helper only resolves the policy value.
export function interpretModelControl(input: {
  readonly node: ModelAttributeAst;
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ControlPolicy | undefined {
  const result = interpretAttribute(
    input.node,
    controlModelSpec,
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
  return result.value.policy;
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
