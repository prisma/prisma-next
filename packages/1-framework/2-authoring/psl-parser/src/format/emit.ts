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
 * Emission is driven by the CST token stream rather than reconstructed from AST
 * accessors as strings. A {@link LineWriter} owns spacing, indentation, blank
 * lines, and the one universal rule that makes this design pay off: a `//`
 * (or `///`) line comment appearing between *any* two tokens forces a hard
 * break — the comment is written, the line ends, and the continuation is
 * indented one extra level until the enclosing construct's emission completes.
 *
 * Per-construct functions stay, but they *drive* the writer (writing the
 * construct's significant tokens to its structural boundaries, letting the
 * writer normalise the interleaved trivia) instead of building strings. The
 * one place column widths are needed — a block's aligned field/enum rows — is
 * a pure function of the block AST, computed in a pre-pass and padded to while
 * the tokens stream past, so the writer stays single-pass with no buffering.
 */

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter(indentUnit, newline);
  emitRegion(writer, Array.from(document.syntax.children()), 0, undefined);
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
   * matching {@link unindent} once the construct finishes — see
   * {@link emitDeclarationTokens}.
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
 * A region is the document body or a block interior. {@link emitRegion} walks
 * the region's source-order elements once, separating significant member nodes
 * (driven through {@link emitMember}) from the inter-member trivia it must
 * canonicalise: blank lines (author runs collapse to one, never adjacent to a
 * brace), own-line leading comments, same-line trailing comments, and the
 * `{ // header` and dangling-before-close comment positions. Brace tokens, when
 * present, delimit the interior; `closeKind` is the token kind that ends the
 * region (`RBrace` for a block, `undefined` for the document).
 */
function emitRegion(
  writer: LineWriter,
  elements: readonly SyntaxElement[],
  depth: number,
  closeKind: 'RBrace' | undefined,
): void {
  const members = collectMembers(elements, closeKind);
  emitMembers(writer, members, depth);
}

interface MemberItem {
  readonly kind: 'member';
  readonly node: SyntaxNode;
  readonly leading: readonly string[];
  trailing: string | undefined;
  readonly blankBefore: boolean;
}

interface CommentItem {
  readonly kind: 'comment';
  readonly text: string;
  readonly blankBefore: boolean;
}

type RegionItem = MemberItem | CommentItem;

/**
 * One source-order pass over a region's elements, reducing interleaved nodes
 * and trivia into a flat member/dangling-comment sequence with each item's
 * leading comments, same-line trailing comment, and whether a (single) blank
 * line precedes it already resolved. A same-line comment after the opening
 * `{` attaches to the just-written block header by the caller; here it surfaces
 * as a trailing comment on no member, so it is captured as a header trailing by
 * {@link emitBlock} before the region walk begins. Blank-line runs collapse to
 * one and never sit directly after the opening boundary nor before the close.
 */
function collectMembers(
  elements: readonly SyntaxElement[],
  closeKind: 'RBrace' | undefined,
): RegionItem[] {
  const items: RegionItem[] = [];
  let leading: string[] = [];
  let blankPending = false;
  let sawContent = false;
  let sawOpenBrace = closeKind === undefined;
  let newlines = 0;

  for (const element of elements) {
    if (element instanceof SyntaxNode) {
      if (!sawOpenBrace) continue;
      if (newlines >= 2 && sawContent && leading.length === 0) blankPending = true;
      items.push({
        kind: 'member',
        node: element,
        leading,
        trailing: undefined,
        blankBefore: blankPending,
      });
      leading = [];
      blankPending = false;
      sawContent = true;
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
      const last = items.at(-1);
      if (closeKind === 'RBrace' && newlines === 0 && !sawContent && items.length === 0) {
        // Same-line comment trailing the opening `{`: owned by the block header.
        continue;
      }
      if (newlines === 0 && last?.kind === 'member' && last.trailing === undefined) {
        last.trailing = element.text;
      } else {
        if (newlines >= 2 && sawContent && leading.length === 0) blankPending = true;
        leading.push(element.text);
        sawContent = true;
      }
      newlines = 0;
    }
  }
  if (leading.length > 0) {
    let blank = blankPending;
    for (const comment of leading) {
      items.push({ kind: 'comment', text: comment, blankBefore: blank });
      blank = false;
    }
  }
  return items;
}

/**
 * Renders the sequenced region items. Consecutive single-line field/enum
 * members with no leading comment form an alignment run, padded to widths
 * computed from the run's AST; everything else (blocks, block attributes,
 * key/value pairs, named types, members that carry a leading comment or an
 * interior comment break) renders on its own. The blank before a block, and
 * before the first block attribute of a block, is house style applied here.
 */
function emitMembers(writer: LineWriter, items: readonly RegionItem[], depth: number): void {
  let run: MemberItem[] = [];
  let lastWasRegular = false;
  let emittedInRegion = false;

  const flushRun = (): void => {
    if (run.length === 0) return;
    emitAlignedRun(writer, run, depth);
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'comment') {
      flushRun();
      if (item.blankBefore) writer.blank();
      for (let i = 0; i < depth; i++) writer.indent();
      writer.writeRaw(item.text);
      writer.newline();
      for (let i = 0; i < depth; i++) writer.unindent();
      emittedInRegion = true;
      continue;
    }

    const isBlockAttribute = ModelAttributeAst.cast(item.node) !== undefined;
    const isBlock = isBlockMember(item.node);

    if (item.blankBefore) {
      flushRun();
      writer.blank();
    } else if (isBlockAttribute && lastWasRegular && emittedInRegion && !writer.lastIsBlank()) {
      flushRun();
      writer.blank();
    } else if (isBlock && emittedInRegion && !writer.lastIsBlank()) {
      flushRun();
      writer.blank();
    }
    emittedInRegion = true;

    if (
      item.leading.length === 0 &&
      !isBlock &&
      isAlignmentRow(item.node) &&
      !hasInteriorComment(item.node)
    ) {
      run.push(item);
      lastWasRegular = true;
      continue;
    }

    flushRun();
    for (let i = 0; i < depth; i++) writer.indent();
    for (const comment of item.leading) {
      writer.writeRaw(comment);
      writer.newline();
    }
    for (let i = 0; i < depth; i++) writer.unindent();
    emitMember(writer, item, depth, undefined);
    lastWasRegular = !isBlockAttribute;
  }
  flushRun();
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

/** A field or enum value: the row kinds whose columns are aligned per block. */
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
 * Emits one non-row member: a nested block, a block attribute, a key/value
 * pair, a named type, or a single field/enum row outside an alignment run. The
 * driver walks the member's own children, writing significant tokens through
 * the writer (which applies spacing) and routing every interior `//` comment
 * through the universal break+indent rule, then appends the same-line trailing
 * comment.
 */
function emitMember(
  writer: LineWriter,
  item: MemberItem,
  depth: number,
  columns: AlignmentColumns | undefined,
): void {
  const node = item.node;
  if (emitBlock(writer, node, depth, item.trailing)) return;

  for (let i = 0; i < depth; i++) writer.indent();
  const continuation = emitDeclarationTokens(writer, node, columns);
  if (item.trailing !== undefined) writer.comment(item.trailing);
  else writer.newline();
  for (let i = 0; i < continuation; i++) writer.unindent();
  for (let i = 0; i < depth; i++) writer.unindent();
}

/**
 * Walks a non-block member node's children in source order, streaming its
 * significant tokens through the writer and routing every interior `//` comment
 * through the universal break+indent rule (the continuation indent is popped
 * when the member finishes). Spacing is decided here from the structural
 * context: tokens inside a qualified name hug. When `columns` is present the
 * walker pads to the type column at the first token of the field's type
 * annotation and to the attribute column at the first token of its first field
 * attribute, so an aligned run lays its columns out without buffering.
 */
function emitDeclarationTokens(
  writer: LineWriter,
  node: SyntaxNode,
  columns: AlignmentColumns | undefined,
): number {
  let continuation = 0;
  let padNext: number | undefined;
  let sawAttribute = false;
  let prevQualified = false;

  const walk = (parent: SyntaxNode, qualified: boolean): void => {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        if (columns && child.kind === 'TypeAnnotation') padNext = columns.typeColumn;
        if (child.kind === 'FieldAttribute') {
          if (continuation > 0) writer.newline();
          else if (columns && !sawAttribute) padNext = columns.attributeColumn;
          sawAttribute = true;
        }
        walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
      if (child.kind === 'Comment') {
        writer.comment(child.text);
        writer.indent();
        continuation += 1;
        padNext = undefined;
        prevQualified = false;
        continue;
      }
      const space = spaceBetween(writer.prevKind(), child.kind, qualified && prevQualified);
      writer.write(child, space, writer.lineOpen() ? padNext : undefined);
      padNext = undefined;
      prevQualified = qualified;
    }
  };
  walk(node, false);
  return continuation;
}

interface AlignmentColumns {
  readonly typeColumn: number;
  readonly attributeColumn: number;
}

/**
 * Renders a run of single-line field rows as an aligned table. The column
 * widths are a pure function of the rows' ASTs (the rendered name and type
 * cells), computed here in a pre-pass, then padded to while each row's tokens
 * stream past — no line buffering. The type column opens one space past the
 * widest name; the attribute column one space past the widest name+type cell.
 */
function emitAlignedRun(writer: LineWriter, rows: readonly MemberItem[], depth: number): void {
  const columns = alignmentColumns(rows);
  for (const row of rows) emitMember(writer, row, depth, columns);
}

function alignmentColumns(rows: readonly MemberItem[]): AlignmentColumns {
  let nameWidth = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row.node);
    if (!field) continue;
    nameWidth = Math.max(nameWidth, renderTokens(field.name()?.syntax).length);
  }
  const typeColumn = nameWidth + 1;
  let cellEnd = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row.node);
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
 * namespace / `types`). Returns `true` when handled. The header line carries
 * the block's `{ // header` same-line comment (if any); the closing line
 * carries the comment that trailed the member's `}` on the same source line.
 * The interior recurses through {@link emitRegion} at the deeper indent.
 */
function emitBlock(
  writer: LineWriter,
  node: SyntaxNode,
  depth: number,
  closingTrailing: string | undefined,
): boolean {
  if (!isBlockMember(node)) return false;

  const children = Array.from(node.children());
  const openIndex = children.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');

  for (let i = 0; i < depth; i++) writer.indent();
  for (let i = 0; i <= openIndex; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child instanceof SyntaxNode) {
      emitInlineNode(writer, child);
      continue;
    }
    if (child.kind === 'Whitespace' || child.kind === 'Newline' || child.kind === 'Comment') {
      continue;
    }
    writer.write(child, spaceBetween(writer.prevKind(), child.kind, false));
  }
  const headerComment = sameLineCommentAfter(children, openIndex);
  if (headerComment !== undefined) writer.comment(headerComment);
  else writer.newline();
  for (let i = 0; i < depth; i++) writer.unindent();

  emitRegion(writer, children, depth + 1, 'RBrace');

  for (let i = 0; i < depth; i++) writer.indent();
  writer.writeRaw('}');
  if (closingTrailing !== undefined) writer.comment(closingTrailing);
  else writer.newline();
  for (let i = 0; i < depth; i++) writer.unindent();
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

/** Writes a header sub-node (the block name identifier) as inline tokens. */
function emitInlineNode(writer: LineWriter, node: SyntaxNode): void {
  for (const token of node.tokens()) {
    if (token.kind === 'Whitespace' || token.kind === 'Newline' || token.kind === 'Comment') {
      continue;
    }
    writer.write(token, spaceBetween(writer.prevKind(), token.kind, false));
  }
}
