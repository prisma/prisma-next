import { ModelAttributeAst } from '../syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../syntax/ast/declarations';
import { type SyntaxElement, SyntaxNode, type SyntaxToken } from '../syntax/red';
import type { TokenKind } from '../tokenizer';

/**
 * Emission is one source-order walk of the CST token stream. A {@link LineWriter}
 * owns spacing, indentation, and blank lines; the trivia *in the stream* decides
 * layout in place — an own-line comment writes on its own line, a same-line
 * comment trails the current line, an author blank-run collapses to one blank,
 * and a `//` (or `///`) comment between *any* two significant tokens forces a
 * hard break: the comment is written, the line ends, and the continuation is
 * indented one extra level until the enclosing construct finishes.
 *
 * Per-construct drivers stay, but they *drive* the writer through
 * {@link writeUntil} (streaming significant tokens to a structural boundary,
 * letting the writer normalise the interleaved trivia) instead of building
 * strings. The one place column widths are needed — a block's aligned field rows
 * — is a pure function of the block AST, computed in a per-region pre-pass and
 * padded to while the tokens stream past, so the walk stays single-pass with no
 * output buffering.
 */

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter(indentUnit, newline);
  emitRegion(writer, Array.from(document.syntax.children()), undefined);
  return writer.finish();
}

/**
 * Accumulates the emitted output line by line. Indentation is materialised at
 * line start from the current depth; a `//` comment encountered mid-line is
 * appended and then forces {@link newline} plus an extra continuation
 * {@link indent}, which the driving construct balances with {@link unindent}
 * once it has emitted all of its tokens. Spacing between significant tokens is
 * applied here from the token kinds and their parent node kind, so the
 * canonical punctuation layout lives in one place.
 */
class LineWriter {
  readonly #indentUnit: string;
  readonly #newline: string;
  readonly #out: string[] = [];
  #depth = 0;
  #line = '';
  #lineOpen = false;
  #prevKind: TokenKind | undefined;
  #lastWasBlank = false;
  #hasContent = false;

  constructor(indentUnit: string, newline: string) {
    this.#indentUnit = indentUnit;
    this.#newline = newline;
  }

  indent(): void {
    this.#depth += 1;
  }

  unindent(): void {
    this.#depth = Math.max(0, this.#depth - 1);
  }

  lastIsBlank(): boolean {
    return this.#lastWasBlank;
  }

  /** Ends the current line (no-op when no line is open). */
  newline(): void {
    if (!this.#lineOpen) return;
    this.#out.push(`${this.#indentUnit.repeat(this.#depth)}${this.#line}`);
    this.#line = '';
    this.#lineOpen = false;
    this.#prevKind = undefined;
    this.#lastWasBlank = false;
    this.#hasContent = true;
  }

  /** Emits one blank line, collapsing a run and never doubling. */
  blank(): void {
    this.newline();
    if (!this.#hasContent || this.#lastWasBlank) return;
    this.#out.push('');
    this.#lastWasBlank = true;
  }

  /**
   * Writes one significant token's text. When `padTo` is set the line is first
   * padded out to that column (an alignment-column boundary); otherwise a single
   * space is inserted iff `space` is true. The driving walker decides spacing
   * from the structural context (e.g. tokens inside a qualified name hug), so
   * the canonical layout rule lives next to the token walk.
   */
  write(token: SyntaxToken, space: boolean, padTo?: number): void {
    if (this.#lineOpen && padTo !== undefined) {
      this.#line = this.#line.padEnd(padTo);
    } else if (this.#lineOpen && space) {
      this.#line += ' ';
    }
    this.#line += token.text;
    this.#lineOpen = true;
    this.#prevKind = token.kind;
  }

  prevKind(): TokenKind | undefined {
    return this.#prevKind;
  }

  lineOpen(): boolean {
    return this.#lineOpen;
  }

  /** Appends raw text to the current line with no spacing logic. */
  writeRaw(text: string): void {
    this.#line += text;
    this.#lineOpen = true;
  }

  /**
   * Writes a `//`/`///` comment as a hard break: the comment trails the current
   * line (or stands alone if the line is empty), the line ends, and the
   * continuation is indented one extra level. The caller is responsible for the
   * matching {@link unindent} once the construct finishes.
   */
  comment(text: string): void {
    if (this.#lineOpen) this.#line += ` ${text}`;
    else this.#line = text;
    this.#lineOpen = true;
    this.newline();
  }

  finish(): string {
    this.newline();
    const body = this.#out.join(this.#newline);
    return body.length > 0 ? `${body}${this.#newline}` : '';
  }
}

/**
 * Canonical inter-token spacing: whether a single space precedes `cur` given the
 * previous token `prev`. `inQualifiedName` flags that both tokens sit inside a
 * qualified name (`space:Type`, `ns.Type`, `supabase:auth.User`), where every
 * segment and separator hugs — the one context that flips the colon from the
 * argument/object form (`name: value`, hug-then-space) to the namespace form.
 */
function spaceBetween(
  prev: TokenKind | undefined,
  cur: TokenKind,
  inQualifiedName: boolean,
): boolean {
  if (prev === undefined) return false;
  if (inQualifiedName) return false;

  switch (cur) {
    case 'LParen':
    case 'LBracket':
    case 'RParen':
    case 'RBracket':
    case 'Comma':
    case 'Question':
    case 'Dot':
    case 'Colon':
      return false;
    case 'RBrace':
      return prev !== 'LBrace';
    default:
      break;
  }
  switch (prev) {
    case 'LParen':
    case 'LBracket':
    case 'Dot':
    case 'At':
    case 'DoubleAt':
      return false;
    default:
      return true;
  }
}

/**
 * One significant token (or interior `//` comment) flattened out of a node's
 * sub-tree in source order, annotated with the structural facts the writer needs
 * but cannot see from the flat token alone: whether it sits inside a qualified
 * name (colon/dot hug), and whether it opens a field's type annotation or its
 * first/next field attribute (the alignment-pad and attribute-break boundaries).
 */
interface StreamToken {
  readonly token: SyntaxToken;
  readonly inQualifiedName: boolean;
  readonly typeAnnotationStart: boolean;
  readonly fieldAttributeStart: boolean;
}

/**
 * Flattens a node's significant tokens and interior `//` comments in source
 * order, dropping whitespace/newline trivia (the writer re-derives spacing). The
 * first significant token of a `TypeAnnotation` / `FieldAttribute` child is
 * flagged so the driver can pad to a column or break a continuation in place.
 */
function* streamTokens(node: SyntaxNode): Generator<StreamToken> {
  let pendingTypeAnnotation = false;
  let pendingFieldAttribute = false;

  function* walk(parent: SyntaxNode, qualified: boolean): Generator<StreamToken> {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        if (child.kind === 'TypeAnnotation') pendingTypeAnnotation = true;
        if (child.kind === 'FieldAttribute') pendingFieldAttribute = true;
        yield* walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
      const typeAnnotationStart = pendingTypeAnnotation;
      const fieldAttributeStart = pendingFieldAttribute && child.kind !== 'Comment';
      if (child.kind !== 'Comment') {
        pendingTypeAnnotation = false;
        if (fieldAttributeStart) pendingFieldAttribute = false;
      }
      yield { token: child, inQualifiedName: qualified, typeAnnotationStart, fieldAttributeStart };
    }
  }

  yield* walk(node, false);
}

/**
 * Streams the significant tokens of `syntax` through the writer until (and
 * including) the next token of `tokenKind` — or to exhaustion when `tokenKind`
 * is `undefined` — normalising trivia and applying the universal `//`-comment
 * break+indent rule in place. Returns the number of continuation indents pushed
 * by interior comments, which the driver must {@link LineWriter.unindent} once
 * the construct finishes. `columns`, when present, pads to the type and
 * attribute columns of an aligned field row as the stream reaches them. A block
 * driver calls it with `LBrace` to write just the header up to the opening `{`.
 */
function writeUntil(
  writer: LineWriter,
  syntax: SyntaxNode,
  tokenKind: TokenKind | undefined,
  columns: AlignmentColumns | undefined,
): number {
  let continuation = 0;
  let prevQualified = false;
  let sawAttribute = false;

  for (const entry of streamTokens(syntax)) {
    const { token } = entry;
    if (token.kind === 'Comment') {
      writer.comment(token.text);
      writer.indent();
      continuation += 1;
      prevQualified = false;
      continue;
    }

    let padTo: number | undefined;
    if (entry.fieldAttributeStart) {
      if (continuation > 0) writer.newline();
      else if (columns && !sawAttribute) padTo = columns.attributeColumn;
      sawAttribute = true;
    } else if (entry.typeAnnotationStart && columns) {
      padTo = columns.typeColumn;
    }

    const space = spaceBetween(
      writer.prevKind(),
      token.kind,
      entry.inQualifiedName && prevQualified,
    );
    writer.write(token, space, writer.lineOpen() ? padTo : undefined);
    prevQualified = entry.inQualifiedName;

    if (tokenKind !== undefined && token.kind === tokenKind) break;
  }

  return continuation;
}

/**
 * A region is the document body or a block interior. The single source-order
 * walk writes each member as it is reached and lets the interleaved trivia
 * decide layout in place: a same-line comment trails the line just written; an
 * own-line comment (preceded by a newline) writes on its own line; a `≥2`
 * newline run between members collapses to exactly one blank (never adjacent to a
 * brace); a nested block, and the first block attribute of a block, get one
 * house-style blank, decided from what the writer just emitted. `closeKind` is
 * the token kind that ends the region (`RBrace` for a block, `undefined` for the
 * document); for a block the walk skips everything up to and including the
 * opening `{` (the block header is written by {@link emitBlock}).
 */
function emitRegion(
  writer: LineWriter,
  elements: readonly SyntaxElement[],
  closeKind: 'RBrace' | undefined,
): void {
  const alignment = alignmentMap(elements, closeKind);

  let sawOpenBrace = closeKind === undefined;
  let sawContent = false;
  let lastWasRegular = false;
  let ledByComment = false;
  let newlines = 0;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;

    if (element instanceof SyntaxNode) {
      if (!sawOpenBrace) continue;
      const isBlockAttribute = ModelAttributeAst.cast(element) !== undefined;
      // When a leading comment run precedes the member it attaches directly: any
      // author blank is dropped and the comment already placed the house-style
      // separation blank. Otherwise the member places its own blank here.
      if (!ledByComment) {
        if (newlines >= 2 && sawContent && !writer.lastIsBlank()) writer.blank();
        else if (separationBlankWanted(writer, element, sawContent, lastWasRegular)) writer.blank();
      }

      const trailing = sameLineTrailingComment(elements, i);
      emitMember(writer, element, alignment.get(element), trailing.text);
      if (trailing.index !== undefined) i = trailing.index;
      sawContent = true;
      lastWasRegular = !isBlockAttribute;
      ledByComment = false;
      newlines = 0;
      continue;
    }

    if (element.kind === 'LBrace' && closeKind === 'RBrace' && !sawOpenBrace) {
      sawOpenBrace = true;
      newlines = 0;
      continue;
    }
    if (!sawOpenBrace) continue;
    if (closeKind === 'RBrace' && element.kind === 'RBrace') break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Newline') {
      newlines += 1;
      continue;
    }
    if (element.kind === 'Comment') {
      if (closeKind === 'RBrace' && newlines === 0 && !sawContent) {
        // Same-line comment trailing the opening `{`: owned by the block header.
        continue;
      }
      if (newlines >= 2 && sawContent && !writer.lastIsBlank()) writer.blank();
      else if (!ledByComment) {
        // The first comment of a leading run carries the separation blank of the
        // block / block-attribute it leads, so the blank lands before the
        // comment rather than between the comment and the member.
        const led = leadingMemberAfter(elements, i);
        if (led && separationBlankWanted(writer, led, sawContent, lastWasRegular)) writer.blank();
      }
      writer.writeRaw(element.text);
      writer.newline();
      sawContent = true;
      ledByComment = true;
      newlines = 0;
    }
  }
}

/**
 * Whether the house style places a blank before `member`: one blank before a
 * nested block, and one before the first block attribute that follows a regular
 * member. Decided purely from the writer's current state (prior content, whether
 * the last line is already blank) and the last member's kind.
 */
function separationBlankWanted(
  writer: LineWriter,
  member: SyntaxNode,
  sawContent: boolean,
  lastWasRegular: boolean,
): boolean {
  if (!sawContent || writer.lastIsBlank()) return false;
  if (isBlockMember(member)) return true;
  return ModelAttributeAst.cast(member) !== undefined && lastWasRegular;
}

/**
 * The member node a comment at `commentIndex` leads — the next member reached by
 * skipping intervening own-line comments and trivia, or `undefined` when the
 * comment is dangling (the region closes first). A pure forward CST scan; it
 * buffers no output.
 */
function leadingMemberAfter(
  elements: readonly SyntaxElement[],
  commentIndex: number,
): SyntaxNode | undefined {
  for (let i = commentIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) return element;
    if (element.kind === 'RBrace') return undefined;
  }
  return undefined;
}

/**
 * The same-line `//` comment that trails the member ending at `memberIndex` — the
 * next non-whitespace element when it is a `Comment` reached with no intervening
 * newline. Returns its text and the element index to skip past, or `undefined`
 * for both when the member is the last thing on its source line.
 */
function sameLineTrailingComment(
  elements: readonly SyntaxElement[],
  memberIndex: number,
): { text: string | undefined; index: number | undefined } {
  for (let i = memberIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Comment') return { text: element.text, index: i };
    break;
  }
  return { text: undefined, index: undefined };
}

function isBlockMember(node: SyntaxNode): boolean {
  return (
    ModelDeclarationAst.cast(node) !== undefined ||
    CompositeTypeDeclarationAst.cast(node) !== undefined ||
    NamespaceDeclarationAst.cast(node) !== undefined ||
    TypesBlockAst.cast(node) !== undefined ||
    GenericBlockDeclarationAst.cast(node) !== undefined
  );
}

/** A field: the row kind whose name/type columns are aligned per block. */
function isAlignmentRow(node: SyntaxNode): boolean {
  return FieldDeclarationAst.cast(node) !== undefined;
}

/**
 * Whether a member's token stream carries a `//` comment before its closing
 * boundary — the interior-comment break that pulls the member out of an
 * alignment run (its continuation attributes drop to their own indented lines).
 */
function hasInteriorComment(node: SyntaxNode): boolean {
  for (const token of node.tokens()) {
    if (token.kind === 'Comment') return true;
  }
  return false;
}

/**
 * Emits one member. A block (model / composite type / enum or other generic
 * block / namespace / `types`) recurses through {@link emitBlock}; everything
 * else streams its own tokens through {@link writeUntil}, routing interior `//`
 * comments through the universal break+indent rule and padding aligned field
 * columns from the precomputed `columns`. The same-line `trailing` comment, when
 * present, closes the member's final line.
 */
function emitMember(
  writer: LineWriter,
  node: SyntaxNode,
  columns: AlignmentColumns | undefined,
  trailing: string | undefined,
): void {
  if (emitBlock(writer, node, trailing)) return;

  const continuation = writeUntil(writer, node, undefined, columns);
  if (trailing !== undefined) writer.comment(trailing);
  else writer.newline();
  for (let i = 0; i < continuation; i++) writer.unindent();
}

interface AlignmentColumns {
  readonly typeColumn: number;
  readonly attributeColumn: number;
}

/**
 * The per-region alignment pre-pass: groups consecutive single-line field rows
 * into runs (broken by a blank, an own-line comment, an interior comment, a
 * leading comment on the row, or any non-field member) and maps each field node
 * to its run's column widths. Widths are a pure function of the rows' ASTs (the
 * rendered name and type cells) — no rendered output is buffered; the single
 * walk looks the columns up when it reaches each field.
 */
function alignmentMap(
  elements: readonly SyntaxElement[],
  closeKind: 'RBrace' | undefined,
): Map<SyntaxNode, AlignmentColumns> {
  const map = new Map<SyntaxNode, AlignmentColumns>();
  let sawOpenBrace = closeKind === undefined;
  let newlines = 0;
  let leadingComment = false;
  let run: SyntaxNode[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const columns = alignmentColumns(run);
    for (const node of run) map.set(node, columns);
    run = [];
  };

  for (const element of elements) {
    if (element instanceof SyntaxNode) {
      if (!sawOpenBrace) continue;
      const alignable = isAlignmentRow(element) && !hasInteriorComment(element);
      const poolable = alignable && !leadingComment && !(newlines >= 2 && run.length > 0);
      if (poolable) run.push(element);
      else {
        flush();
        if (alignable && !leadingComment) run.push(element);
        // A row carrying its own leading comment stands alone: it neither joins
        // the prior run nor pools with the row that follows it.
        else if (alignable) {
          run.push(element);
          flush();
        }
      }
      newlines = 0;
      leadingComment = false;
      continue;
    }
    if (element.kind === 'LBrace' && closeKind === 'RBrace' && !sawOpenBrace) {
      sawOpenBrace = true;
      newlines = 0;
      continue;
    }
    if (!sawOpenBrace) continue;
    if (closeKind === 'RBrace' && element.kind === 'RBrace') break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Newline') {
      newlines += 1;
      continue;
    }
    if (element.kind === 'Comment') {
      // An own-line comment (preceded by a newline) breaks the run and leads the
      // next row; a same-line trailing comment leaves the run intact.
      if (newlines > 0) {
        flush();
        leadingComment = true;
      }
      newlines = 0;
    }
  }
  flush();
  return map;
}

function alignmentColumns(rows: readonly SyntaxNode[]): AlignmentColumns {
  let nameWidth = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row);
    if (!field) continue;
    nameWidth = Math.max(nameWidth, renderTokens(field.name()?.syntax).length);
  }
  const typeColumn = nameWidth + 1;
  let cellEnd = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row);
    if (!field) continue;
    const name = renderTokens(field.name()?.syntax);
    const type = renderTokens(field.typeAnnotation()?.syntax);
    cellEnd = Math.max(cellEnd, type.length > 0 ? typeColumn + type.length : name.length);
  }
  return { typeColumn, attributeColumn: cellEnd + 1 };
}

/**
 * The canonical text of a sub-tree's significant tokens with spacing applied —
 * used only to measure alignment column widths in the AST pre-pass, never to
 * emit (emission streams tokens through the writer).
 */
function renderTokens(node: SyntaxNode | undefined): string {
  if (!node) return '';
  let out = '';
  let prev: TokenKind | undefined;
  let prevQualified = false;
  const walk = (parent: SyntaxNode, qualified: boolean): void => {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline' || child.kind === 'Comment') {
        continue;
      }
      if (spaceBetween(prev, child.kind, qualified && prevQualified)) out += ' ';
      out += child.text;
      prev = child.kind;
      prevQualified = qualified;
    }
  };
  walk(node, false);
  return out;
}

/**
 * Emits a block member (model / composite type / enum or other generic block /
 * namespace / `types`). Returns `true` when handled. The header is streamed up to
 * and including the opening `{` via {@link writeUntil}; a same-line `{ // header`
 * comment trails it; the interior recurses through {@link emitRegion}; the close
 * `}` carries the comment that trailed it on the same source line.
 */
function emitBlock(
  writer: LineWriter,
  node: SyntaxNode,
  closingTrailing: string | undefined,
): boolean {
  if (!isBlockMember(node)) return false;

  const children = Array.from(node.children());
  writeUntil(writer, node, 'LBrace', undefined);

  const openIndex = children.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');
  const headerComment = sameLineCommentAfter(children, openIndex);
  if (headerComment !== undefined) writer.comment(headerComment);
  else writer.newline();

  writer.indent();
  emitRegion(writer, children, 'RBrace');
  writer.unindent();

  writer.writeRaw('}');
  if (closingTrailing !== undefined) writer.comment(closingTrailing);
  else writer.newline();
  return true;
}

/**
 * The same-line `//` comment trailing the opening `{` (a `{ // header` block),
 * found by scanning the children just past the brace up to the first newline.
 * `undefined` when the brace is the last thing on its line.
 */
function sameLineCommentAfter(
  children: readonly SyntaxElement[],
  openIndex: number,
): string | undefined {
  for (let i = openIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child instanceof SyntaxNode) return undefined;
    if (child.kind === 'Whitespace') continue;
    if (child.kind === 'Comment') return child.text;
    return undefined;
  }
  return undefined;
}
