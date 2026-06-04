/**
 * Shape-only PSL substrate types. These live in the shared plane
 * because they participate in the authoring-contributions descriptor
 * surface (`AuthoringPslBlockDescriptor` in `framework-authoring`),
 * which is itself shared so target packs can declare their
 * contribution shape without depending on migration-plane code.
 *
 * The PSL AST node types (`PslModel`, `PslEnum`, …) and the parser
 * itself remain in the migration plane — only the source-position
 * primitives, diagnostic codes, and pack-block SPI types are
 * factored out here so the descriptor's parser-function shape can
 * narrow without crossing the shared → migration plane boundary.
 *
 * Ref: TML-2804.
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
 * Base shape for a pack-contributed top-level PSL block. The
 * framework parser stores instances of this base under
 * `PslNamespace.packBlocks`; each contribution narrows the shape
 * with its own `kind` discriminator and additional fields the
 * contribution's printer + lowering factory consume. The mandatory
 * `name` lets the lowering registry index pack-contributed entries
 * by name without per-contribution machinery.
 */
export interface PslPackBlock {
  readonly kind: string;
  readonly name: string;
  readonly span: PslSpan;
}

/**
 * Half-open block extent in the source schema. `startLine` is the
 * line index of the opening brace; `endLine` is the line index of
 * the matching closing brace. `closed` is false when the parser
 * walked past the end of input without finding the closer (a
 * `PSL_UNTERMINATED_BLOCK` diagnostic is emitted by the framework
 * before the contribution is invoked).
 */
export interface PslPackBlockBounds {
  readonly startLine: number;
  readonly endLine: number;
  readonly closed: boolean;
}

/**
 * Diagnostic shape a pack-contributed parser emits via the SPI's
 * `pushDiagnostic`. The framework attaches `sourceId` itself before
 * adding the entry to the document's diagnostics list, so the
 * contribution does not name the source.
 */
export interface PslPackBlockDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly span: PslSpan;
}

/**
 * Handle a pack-contributed parser receives when the framework
 * dispatches a registered top-level keyword. The shape is the
 * minimum needed to write a parser for a `keyword Name { key = value
 * }`-shape block:
 *
 * - `name` is the block's name (already extracted from the opener
 *   line; mandatory because every contributed kind ships with one).
 * - `keyword` is the dispatch key (e.g. `policy`).
 * - `keywordSpan` covers the opener line; useful for diagnostics
 *   that target the keyword rather than the body.
 * - `bounds` is the brace-delimited body extent.
 * - `lines` is the full normalised source split by `\n`. Combined
 *   with `bounds`, the contribution iterates body lines without
 *   needing a slice copy.
 * - `stripInlineComment`, `trimmedLineSpan`, `inlineSpan`,
 *   `lineRangeSpan` mirror the framework's internal helpers; pack
 *   parsers reach for these to walk lines and emit spans without
 *   reimplementing position arithmetic.
 * - `pushDiagnostic` appends to the document's diagnostics list.
 *
 * The SPI is intentionally minimal — only what a `policy`-shaped
 * RLS-style block parser actually needs. Helpers that turn out to
 * be load-bearing for a real consumer get lifted from the
 * framework's private parser into this surface as a separate
 * follow-up.
 */
export interface PslPackBlockParserContext {
  readonly name: string;
  readonly keyword: string;
  readonly keywordSpan: PslSpan;
  readonly bounds: PslPackBlockBounds;
  readonly lines: readonly string[];
  readonly stripInlineComment: (line: string) => string;
  readonly trimmedLineSpan: (lineIndex: number) => PslSpan;
  readonly inlineSpan: (lineIndex: number, startColumn: number, endColumn: number) => PslSpan;
  readonly lineRangeSpan: (startLine: number, endLine: number) => PslSpan;
  readonly pushDiagnostic: (diagnostic: PslPackBlockDiagnostic) => void;
}
