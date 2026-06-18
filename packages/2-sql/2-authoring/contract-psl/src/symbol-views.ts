import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  CompositeTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  ScalarSymbol,
  TypeAliasSymbol,
} from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import {
  nodePslSpan,
  rangeToPslSpan,
  readAttributeView,
  readConstructorCall,
  readFieldTypeAnnotation,
} from './cst-read';
import type {
  CstCompositeTypeView,
  CstFieldView,
  CstModelView,
  CstNamedTypeView,
} from './cst-read-views';

/**
 * Build the dispatch-3 read views directly from symbol-table entries + their
 * CST `.node`, replacing the legacy `Psl*` object construction the interpreter
 * entry used to do. Over-qualified field types (which the legacy parser rejected
 * at parse time) are surfaced here as `PSL_INVALID_QUALIFIED_TYPE`, preserving
 * the diagnostic code.
 */
export function buildFieldView(
  field: FieldSymbol,
  sourceFile: SourceFile,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): CstFieldView {
  const annotation = readFieldTypeAnnotation(field.node, sourceFile);
  const attributes = Array.from(field.node.attributes(), (attribute) =>
    readAttributeView(attribute, sourceFile),
  );
  const span = nodePslSpan(field.node.syntax, sourceFile);

  if (!annotation.ok) {
    diagnostics.push({
      code: annotation.code,
      message: `Field "${field.name}" has an invalid qualified type "${annotation.path.join('.')}"; use at most one namespace qualifier (e.g. "ns.TypeName")`,
      sourceId,
      span: rangeToPslSpan(annotation.range, sourceFile),
    });
    return {
      name: field.name,
      typeName: annotation.path[annotation.path.length - 1] ?? '',
      optional: false,
      list: false,
      attributes,
      span,
    };
  }

  const typeConstructor = annotation.annotation.isConstructor
    ? readConstructorCall(field.node.typeAnnotation(), sourceFile)
    : undefined;

  return {
    name: field.name,
    typeName: annotation.annotation.typeName ?? '',
    ...(annotation.annotation.typeNamespaceId !== undefined
      ? { typeNamespaceId: annotation.annotation.typeNamespaceId }
      : {}),
    ...(annotation.annotation.typeContractSpaceId !== undefined
      ? { typeContractSpaceId: annotation.annotation.typeContractSpaceId }
      : {}),
    optional: annotation.annotation.optional,
    list: annotation.annotation.list,
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes,
    span,
  };
}

export function buildModelView(
  model: ModelSymbol,
  sourceFile: SourceFile,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): CstModelView {
  return {
    name: model.name,
    fields: Object.values(model.fields).map((field) =>
      buildFieldView(field, sourceFile, sourceId, diagnostics),
    ),
    attributes: Array.from(model.node.attributes(), (attribute) =>
      readAttributeView(attribute, sourceFile),
    ),
    span: nodePslSpan(model.node.syntax, sourceFile),
  };
}

export function buildCompositeTypeView(
  compositeType: CompositeTypeSymbol,
  sourceFile: SourceFile,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): CstCompositeTypeView {
  return {
    name: compositeType.name,
    fields: Object.values(compositeType.fields).map((field) =>
      buildFieldView(field, sourceFile, sourceId, diagnostics),
    ),
    attributes: Array.from(compositeType.node.attributes(), (attribute) =>
      readAttributeView(attribute, sourceFile),
    ),
    span: nodePslSpan(compositeType.node.syntax, sourceFile),
  };
}

export function buildNamedTypeView(
  symbol: ScalarSymbol | TypeAliasSymbol,
  sourceFile: SourceFile,
): CstNamedTypeView {
  const annotation = symbol.node.typeAnnotation();
  const isConstructor = annotation?.isConstructor() ?? false;
  const baseType = annotation?.name()?.identifier()?.name();
  const typeConstructor = readConstructorCall(annotation, sourceFile);

  return {
    name: symbol.name,
    isConstructor,
    ...(!isConstructor && baseType !== undefined ? { baseType } : {}),
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes: Array.from(symbol.node.attributes(), (attribute) =>
      readAttributeView(attribute, sourceFile),
    ),
    span: nodePslSpan(symbol.node.syntax, sourceFile),
  };
}
