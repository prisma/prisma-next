import type { AuthoringPslBlockNamespace } from '../shared/framework-authoring';
import type { PslDiagnosticCode, PslPackBlock, PslSpan } from '../shared/psl-substrate';

export type {
  PslDiagnosticCode,
  PslPackBlock,
  PslPackBlockBounds,
  PslPackBlockDiagnostic,
  PslPackBlockParserContext,
  PslPackBlockPrinterContext,
  PslPosition,
  PslSpan,
} from '../shared/psl-substrate';

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

export type PslAttributeTarget = 'field' | 'model' | 'enum' | 'namedType';

export interface PslAttributePositionalArgument {
  readonly kind: 'positional';
  readonly value: string;
  readonly span: PslSpan;
}

export interface PslAttributeNamedArgument {
  readonly kind: 'named';
  readonly name: string;
  readonly value: string;
  readonly span: PslSpan;
}

export type PslAttributeArgument = PslAttributePositionalArgument | PslAttributeNamedArgument;

export interface PslTypeConstructorCall {
  readonly kind: 'typeConstructor';
  readonly path: readonly string[];
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export interface PslAttribute {
  readonly kind: 'attribute';
  readonly target: PslAttributeTarget;
  readonly name: string;
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export type PslReferentialAction = string;

export type PslFieldAttribute = PslAttribute;

export interface PslField {
  readonly kind: 'field';
  readonly name: string;
  /** Unqualified type name, e.g. `"User"` for both `User` and `auth.User`. */
  readonly typeName: string;
  /** Namespace qualifier from a dot-qualified type reference, e.g. `"auth"` for `auth.User`. Absent for unqualified types. */
  readonly typeNamespaceId?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
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

export type PslModelAttribute = PslAttribute;

export interface PslModel {
  readonly kind: 'model';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslModelAttribute[];
  readonly span: PslSpan;
  /**
   * Optional leading comment line emitted above the `model` keyword by the
   * printer. Producers (e.g. `sqlSchemaIrToPslAst`) attach introspection
   * advisories such as "// WARNING: This table has no primary key in the
   * database" here. The parser leaves this field unset; round-tripping a
   * parsed schema does not re-attach comments.
   */
  readonly comment?: string;
}

export interface PslEnumValue {
  readonly kind: 'enumValue';
  readonly name: string;
  /**
   * Optional storage label for the enum member, captured from a trailing
   * `@map("...")` attribute on the member line. The parser populates this
   * when the source PSL carries an explicit `@map`. Producers (e.g.
   * `sqlSchemaIrToPslAst`) leave it unset; the printer emits `@map(...)`
   * automatically when normalisation would change the printed member name
   * (so an enum value `'in-progress'` becomes `inProgress @map("in-progress")`
   * in PSL, preserving the round-trip).
   */
  readonly mapName?: string;
  readonly span: PslSpan;
}

export interface PslEnum {
  readonly kind: 'enum';
  readonly name: string;
  readonly values: readonly PslEnumValue[];
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslCompositeType {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslNamedTypeDeclaration {
  readonly kind: 'namedType';
  readonly name: string;
  /**
   * Parser invariant: exactly one of `baseType` and `typeConstructor` is set.
   * Expressing this as a discriminated union trips TypeScript narrowing when
   * the declaration flows through helpers that accept the full union.
   */
  readonly baseType?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslTypesBlock {
  readonly kind: 'types';
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly span: PslSpan;
}

/**
 * Name of the synthesised namespace bucket the framework parser uses for
 * top-level declarations that appear outside any `namespace { … }` block.
 * The double-underscore decoration signals that the identifier is parser-
 * synthesised and never appears in user-authored PSL source — writing
 * `namespace __unspecified__ { … }` is a parse error.
 *
 * Distinct from the IR sentinel `__unbound__`: the PSL bucket describes
 * syntactic absence at the parser layer; the IR sentinel describes a late-
 * bound storage slot at the IR layer. Per-target interpreters decide how
 * (or whether) to map the PSL bucket to the IR sentinel.
 */
export const UNSPECIFIED_PSL_NAMESPACE_ID = '__unspecified__';

/**
 * A named namespace block from a PSL document, or the parser's synthesised
 * `__unspecified__` bucket for declarations that appear outside any
 * `namespace { … }` block. Multiple `namespace foo { … }` blocks for the
 * same name across one or more files reopen-merge into a single entry;
 * `span` points at the first opening.
 */
export interface PslNamespace {
  readonly kind: 'namespace';
  readonly name: string;
  readonly models: readonly PslModel[];
  readonly enums: readonly PslEnum[];
  readonly compositeTypes: readonly PslCompositeType[];
  /**
   * Pack-contributed top-level blocks parsed inside this namespace.
   * The slot is always present (defaults to `[]` when no
   * contributed-keyword blocks land here). Order matches source
   * order within the namespace; pack-contributed and built-in
   * blocks live in their own slots, so a namespace mixing
   * `model X { … }` and `policy Y { … }` keeps the model in
   * `models` and the policy in `packBlocks`.
   */
  readonly packBlocks: readonly PslPackBlock[];
  readonly span: PslSpan;
}

export interface PslDocumentAst {
  readonly kind: 'document';
  readonly sourceId: string;
  readonly namespaces: readonly PslNamespace[];
  readonly types?: PslTypesBlock;
  readonly span: PslSpan;
}

/**
 * Returns all models from every namespace in document order. Convenience
 * for consumers that don't (yet) need namespace-awareness.
 */
export function flatPslModels(ast: PslDocumentAst): readonly PslModel[] {
  return ast.namespaces.flatMap((ns) => ns.models);
}

/**
 * Returns all enums from every namespace in document order.
 */
export function flatPslEnums(ast: PslDocumentAst): readonly PslEnum[] {
  return ast.namespaces.flatMap((ns) => ns.enums);
}

/**
 * Returns all composite types from every namespace in document order.
 */
export function flatPslCompositeTypes(ast: PslDocumentAst): readonly PslCompositeType[] {
  return ast.namespaces.flatMap((ns) => ns.compositeTypes);
}

export interface ParsePslDocumentInput {
  readonly schema: string;
  readonly sourceId: string;
  /**
   * Pack-contributed parser contributions, indexed by the top-level
   * keyword the parser dispatches on. Typically an
   * `AssembledAuthoringContributions.pslBlocks` namespace produced by
   * `assembleAuthoringContributions` — but the parser only consumes
   * the structural shape, so callers may pass a hand-rolled namespace
   * (e.g. test fixtures). When absent or empty, the parser surfaces
   * the existing `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` diagnostic for any
   * unrecognised top-level keyword.
   */
  readonly pslBlocks?: AuthoringPslBlockNamespace;
}

export interface ParsePslDocumentResult {
  readonly ast: PslDocumentAst;
  readonly diagnostics: readonly PslDiagnostic[];
  readonly ok: boolean;
}
