export interface PslPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface PslSpan {
  readonly start: PslPosition;
  readonly end: PslPosition;
}

export type PslDiagnosticCode =
  | 'PSL_UNTERMINATED_BLOCK'
  | 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK'
  | 'PSL_INVALID_MODEL_MEMBER'
  | 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE'
  | 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE'
  | 'PSL_INVALID_RELATION_ATTRIBUTE'
  | 'PSL_INVALID_REFERENTIAL_ACTION'
  | 'PSL_INVALID_DEFAULT_VALUE'
  | 'PSL_INVALID_ENUM_MEMBER'
  | 'PSL_INVALID_TYPES_MEMBER';

export interface PslDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}

export interface PslDefaultFunctionValue {
  readonly kind: 'function';
  readonly name: 'autoincrement' | 'now';
}

export interface PslDefaultLiteralValue {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
}

export type PslDefaultValue = PslDefaultFunctionValue | PslDefaultLiteralValue;

export interface PslIdAttribute {
  readonly kind: 'id';
  readonly span: PslSpan;
}

export interface PslUniqueAttribute {
  readonly kind: 'unique';
  readonly span: PslSpan;
}

export interface PslDefaultAttribute {
  readonly kind: 'default';
  readonly value: PslDefaultValue;
  readonly span: PslSpan;
}

export interface PslRelationAttribute {
  readonly kind: 'relation';
  readonly fields: readonly string[];
  readonly references: readonly string[];
  readonly onDelete?: PslReferentialAction;
  readonly onUpdate?: PslReferentialAction;
  readonly span: PslSpan;
}

export type PslReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export type PslFieldAttribute =
  | PslIdAttribute
  | PslUniqueAttribute
  | PslDefaultAttribute
  | PslRelationAttribute;

export interface PslField {
  readonly kind: 'field';
  readonly name: string;
  readonly typeName: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeRef?: string;
  readonly attributes: readonly PslFieldAttribute[];
  readonly span: PslSpan;
}

export interface PslUniqueConstraint {
  readonly kind: 'unique';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export interface PslIndexConstraint {
  readonly kind: 'index';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export type PslModelAttribute = PslUniqueConstraint | PslIndexConstraint;

export interface PslModel {
  readonly kind: 'model';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslModelAttribute[];
  readonly span: PslSpan;
}

export interface PslEnumValue {
  readonly kind: 'enumValue';
  readonly name: string;
  readonly span: PslSpan;
}

export interface PslEnum {
  readonly kind: 'enum';
  readonly name: string;
  readonly values: readonly PslEnumValue[];
  readonly span: PslSpan;
}

export interface PslNamedTypeDeclaration {
  readonly kind: 'namedType';
  readonly name: string;
  readonly baseType: string;
  readonly attributes: readonly string[];
  readonly span: PslSpan;
}

export interface PslTypesBlock {
  readonly kind: 'types';
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly span: PslSpan;
}

export interface PslDocumentAst {
  readonly kind: 'document';
  readonly sourceId: string;
  readonly models: readonly PslModel[];
  readonly enums: readonly PslEnum[];
  readonly types?: PslTypesBlock;
  readonly span: PslSpan;
}

export interface ParsePslDocumentInput {
  readonly schema: string;
  readonly sourceId: string;
}

export interface ParsePslDocumentResult {
  readonly ast: PslDocumentAst;
  readonly diagnostics: readonly PslDiagnostic[];
  readonly ok: boolean;
}
