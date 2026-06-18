import type { PslSpan } from '@prisma-next/psl-parser';

/**
 * Package-local read views the Mongo interpreter helpers consume in place of the
 * legacy `Psl*` object shapes, with `PslSpan` diagnostic spans. A trimmed copy
 * of the proven SQL adapter views: Mongo has no enums/extension blocks,
 * named-types, or type constructors, so the named-type and constructor-call
 * view shapes (and the field's constructor slot) are intentionally absent.
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

export interface CstFieldView {
  readonly name: string;
  readonly typeName: string;
  readonly typeNamespaceId?: string;
  readonly typeContractSpaceId?: string;
  readonly typeRef?: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly attributes: readonly CstAttributeView[];
  readonly span: PslSpan;
  /**
   * Set when the field's qualified type was malformed (over-qualified) and the
   * `PSL_INVALID_QUALIFIED_TYPE` diagnostic was already emitted at view-build
   * time. Type resolution treats it as already-reported and does NOT cascade a
   * `PSL_UNSUPPORTED_FIELD_TYPE` — the legacy parser rejected such types before
   * the interpreter ran, so that cascade would be a spurious extra diagnostic.
   */
  readonly typeAlreadyReported?: boolean;
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
