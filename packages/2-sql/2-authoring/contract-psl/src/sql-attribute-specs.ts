import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { FieldSymbol, InterpretCtx, ModelSymbol } from '@prisma-next/psl-parser';
import { fieldAttribute, interpretAttribute, modelAttribute, str } from '@prisma-next/psl-parser';
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
