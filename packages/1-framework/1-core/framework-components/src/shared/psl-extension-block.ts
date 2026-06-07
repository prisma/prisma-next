/**
 * Shape-only types for the PSL source-position primitives, diagnostic
 * codes, extension-block descriptor vocabulary, and the uniform
 * extension-block AST node base.
 *
 * These live in the shared plane so an extension's authoring descriptor
 * (`AuthoringPslBlockDescriptor` in `framework-authoring`) can reference
 * them without crossing the shared → migration-plane boundary. The
 * migration-plane `psl-ast.ts` re-exports everything here for consumers
 * that import PSL AST types from the control entrypoint.
 */

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
  | 'PSL_INVALID_NAMESPACE_BLOCK'
  | 'PSL_INVALID_ATTRIBUTE_SYNTAX'
  | 'PSL_INVALID_MODEL_MEMBER'
  | 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE'
  | 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE'
  | 'PSL_INVALID_RELATION_ATTRIBUTE'
  | 'PSL_INVALID_REFERENTIAL_ACTION'
  | 'PSL_INVALID_DEFAULT_VALUE'
  | 'PSL_INVALID_ENUM_MEMBER'
  | 'PSL_INVALID_TYPES_MEMBER'
  | 'PSL_INVALID_QUALIFIED_TYPE';

/**
 * Descriptor vocabulary for a single parameter on a declared block.
 *
 * Four kinds:
 * - `ref` — the parameter value is an identifier that must resolve to a
 *   declared entity of `refKind` within the declared `scope`.
 * - `value` — the parameter value is a PSL literal parsed and printed
 *   through the codec identified by `codecId`.
 * - `option` — the parameter value is one of the literal tokens in `values`.
 *   Not a codec; not persisted data. A closed authoring-time constraint only.
 * - `list` — a bracketed list whose elements each match the `of` descriptor.
 */
export type PslBlockParam =
  | PslBlockParamRef
  | PslBlockParamValue
  | PslBlockParamOption
  | PslBlockParamList;

export interface PslBlockParamRef {
  readonly kind: 'ref';
  readonly refKind: string;
  readonly scope: 'same-namespace' | 'same-space' | 'cross-space';
  readonly required?: boolean;
}

export interface PslBlockParamValue {
  readonly kind: 'value';
  readonly codecId: string;
  readonly required?: boolean;
}

export interface PslBlockParamOption {
  readonly kind: 'option';
  readonly values: readonly string[];
  readonly required?: boolean;
}

export interface PslBlockParamList {
  readonly kind: 'list';
  readonly of: PslBlockParam;
  readonly required?: boolean;
}

/**
 * The parsed representation of a single parameter value on a uniform
 * extension-block AST node. Mirrors the `PslBlockParam` descriptor
 * vocabulary:
 *
 * - `ref`    → `PslExtensionBlockParamRef` — a raw identifier string
 *   (resolution runs in the validator, not the parser).
 * - `value`  → `PslExtensionBlockParamValue` — a raw PSL literal string
 *   (codec validation runs in the validator).
 * - `option` → `PslExtensionBlockParamOption` — the chosen token.
 * - `list`   → `PslExtensionBlockParamList` — ordered list of the above.
 *
 * These shapes are intentionally minimal for D1. The validator (D4) and
 * lowering (D6) refine and consume them; the parser (D3) produces them.
 */
export type PslExtensionBlockParamValue =
  | PslExtensionBlockParamRef
  | PslExtensionBlockParamScalarValue
  | PslExtensionBlockParamOption
  | PslExtensionBlockParamList;

export interface PslExtensionBlockParamRef {
  readonly kind: 'ref';
  readonly identifier: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamScalarValue {
  readonly kind: 'value';
  readonly raw: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamOption {
  readonly kind: 'option';
  readonly token: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamList {
  readonly kind: 'list';
  readonly items: readonly PslExtensionBlockParamValue[];
  readonly span: PslSpan;
}

/**
 * Base shape for a uniform extension-contributed top-level PSL block
 * node, as produced by the generic framework parser (D3) and consumed
 * by the validator (D4) and lowering factory (D6).
 *
 * - `kind` is the routing discriminant, equal to the descriptor's
 *   `discriminator`. The framework parser sets this to
 *   `descriptor.discriminator` for every block it parses.
 * - `name` is the block's declared name (the identifier after the keyword).
 * - `parameters` is the descriptor-driven parameter map. Keys are
 *   parameter names from the descriptor; values are the parsed parameter
 *   representations. Only parameters present in the source are included
 *   — absence of a required parameter is a validator concern, not a
 *   parser concern.
 * - `span` covers the full block from keyword to closing brace.
 */
export interface PslExtensionBlock {
  readonly kind: string;
  readonly name: string;
  readonly parameters: Record<string, PslExtensionBlockParamValue>;
  readonly span: PslSpan;
}
