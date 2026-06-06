/**
 * Shape-only types for extension-contributed PSL blocks. These live in
 * the shared plane because they participate in the authoring-contributions
 * descriptor surface (`AuthoringPslBlockDescriptor` in
 * `framework-authoring`), which is itself shared so an extension can
 * declare its contribution shape without depending on migration-plane code.
 *
 * The PSL AST node types (`PslModel`, `PslEnum`, …) and the parser
 * itself remain in the migration plane — only the source-position
 * primitives, diagnostic codes, and extension-block SPI types are
 * factored out here so the descriptor's parser-function shape can
 * narrow without crossing the shared → migration plane boundary.
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
  | 'PSL_INVALID_QUALIFIED_TYPE'
  | 'PSL_EXTENSION_BLOCK_PARSE_FAILED';

/**
 * Base shape for an extension-contributed top-level PSL block. The
 * framework parser stores instances of this base under
 * `PslNamespace.extensionBlocks`; each contribution narrows the shape
 * with its own `kind` discriminator and additional fields the
 * contribution's printer + lowering factory consume. The mandatory
 * `name` lets the lowering registry index extension-contributed entries
 * by name without per-contribution machinery.
 */
export interface PslExtensionBlock {
  /**
   * Discriminator for this block kind. This field serves as the routing
   * key in the printer dispatch map: `serializeExtensionBlock` looks up
   * the block's descriptor by `extensionBlock.kind` against a map keyed
   * by `descriptor.discriminator`. The framework parser enforces the
   * invariant `node.kind === descriptor.discriminator` immediately after
   * the contributed parser returns — a mismatch produces a
   * `PSL_EXTENSION_BLOCK_PARSE_FAILED` diagnostic at parse time so the
   * error surfaces close to its cause rather than at `contract infer`
   * print time.
   */
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
export interface PslExtensionBlockBounds {
  readonly startLine: number;
  readonly endLine: number;
  readonly closed: boolean;
}

/**
 * Diagnostic shape an extension-contributed parser emits via the SPI's
 * `pushDiagnostic`. The framework attaches `sourceId` itself before
 * adding the entry to the document's diagnostics list, so the
 * contribution does not name the source.
 */
export interface PslExtensionBlockDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly span: PslSpan;
}

/**
 * Handle an extension-contributed parser receives when the framework
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
 *   `lineRangeSpan` mirror the framework's internal helpers; extension
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
export interface PslExtensionBlockParserContext {
  readonly name: string;
  readonly keyword: string;
  readonly keywordSpan: PslSpan;
  readonly bounds: PslExtensionBlockBounds;
  readonly lines: readonly string[];
  readonly stripInlineComment: (line: string) => string;
  readonly trimmedLineSpan: (lineIndex: number) => PslSpan;
  readonly inlineSpan: (lineIndex: number, startColumn: number, endColumn: number) => PslSpan;
  readonly lineRangeSpan: (startLine: number, endLine: number) => PslSpan;
  readonly pushDiagnostic: (diagnostic: PslExtensionBlockDiagnostic) => void;
}

/**
 * Handle an extension-contributed printer receives when the framework
 * serializer dispatches an extension-contributed AST node. The shape is
 * intentionally minimal — only what's needed to write a printer for
 * a `keyword Name { key = "value" }`-shape block:
 *
 * - `indent` is the body-line indent string (one level of nesting
 *   inside the block opener — typically two spaces). Extension printers
 *   that emit further-nested content can repeat the indent unit.
 *   The serializer wraps the printer's output with namespace-level
 *   indentation when applicable, so extension printers always emit at
 *   the block's own indentation level (i.e. no leading whitespace
 *   on the opener line, body lines indented by one `indent` unit).
 * - `escapeStringLiteral` escapes a raw value into a PSL
 *   double-quoted string body — the contribution wraps the result
 *   in `"…"` itself. Mirrors the framework's internal helper so
 *   extension printers don't reimplement quoting.
 *
 * The SPI is the printer-side mirror of {@link PslExtensionBlockParserContext}.
 * Helpers that turn out to be load-bearing for a real consumer get
 * lifted from the framework's private serializer into this surface
 * as a separate follow-up.
 */
export interface PslExtensionBlockPrinterContext {
  readonly indent: string;
  readonly escapeStringLiteral: (value: string) => string;
}
