import type { PslSpan } from '@prisma-next/psl-parser';

/**
 * Package-local read views the SQL interpreter helpers consume in place of the
 * legacy `Psl*` object shapes. Each view is the exact read-set the helpers
 * touch, with `PslSpan` diagnostic spans so the legacy objects the interpreter
 * entry still builds remain structurally assignable during the migration (the
 * entry's full swap to symbol-table-built views is dispatch 4).
 */
export interface CstAttributeArgView {
  readonly kind: 'positional' | 'named';
  readonly name?: string;
  readonly value: string;
  readonly span: PslSpan;
}

export interface CstAttributeView {
  readonly name: string;
  readonly args: readonly CstAttributeArgView[];
  readonly span: PslSpan;
}

/** A `Type(args…)` constructor call in a named-type binding. */
export interface CstTypeConstructorCallView {
  readonly path: readonly string[];
  readonly args: readonly CstAttributeArgView[];
  readonly span: PslSpan;
}

export interface CstFieldView {
  readonly name: string;
  readonly typeName: string;
  readonly typeNamespaceId?: string;
  readonly typeContractSpaceId?: string;
  readonly typeRef?: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeConstructor?: CstTypeConstructorCallView;
  readonly attributes: readonly CstAttributeView[];
  readonly span: PslSpan;
}

export interface CstModelView {
  readonly name: string;
  readonly fields: readonly CstFieldView[];
  readonly attributes: readonly CstAttributeView[];
  readonly span: PslSpan;
}

export interface CstCompositeTypeView {
  readonly name: string;
  readonly fields: readonly CstFieldView[];
  readonly attributes: readonly CstAttributeView[];
  readonly span: PslSpan;
}

/**
 * A `types { … }` binding view. Exactly one of `baseType` / `typeConstructor`
 * is meaningful, discriminated by {@link isConstructor} (the CST
 * `typeAnnotation().isConstructor()` discriminant the re-union replaces the
 * legacy `baseType` vs `typeConstructor` presence check with).
 */
export interface CstNamedTypeView {
  readonly name: string;
  readonly isConstructor: boolean;
  readonly baseType?: string;
  readonly typeConstructor?: CstTypeConstructorCallView;
  readonly attributes: readonly CstAttributeView[];
  readonly span: PslSpan;
}
