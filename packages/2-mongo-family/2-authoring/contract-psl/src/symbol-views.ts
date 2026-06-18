import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { CompositeTypeSymbol, FieldSymbol, ModelSymbol } from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import {
  nodePslSpan,
  rangeToPslSpan,
  readAttributeView,
  readFieldTypeAnnotation,
} from './cst-read';
import type { CstCompositeTypeView, CstFieldView, CstModelView } from './cst-read-views';

/**
 * Build the Mongo interpreter read views directly from symbol-table entries +
 * their CST `.node`. A trimmed copy of the SQL adapter: Mongo has no
 * named-types or type constructors, so the named-type view builder and the
 * field's constructor handling are absent. Over-qualified field types are
 * surfaced here as `PSL_INVALID_QUALIFIED_TYPE`, preserving the diagnostic code
 * (cross-target parity with SQL).
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
      typeAlreadyReported: true,
      attributes,
      span,
    };
  }

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
