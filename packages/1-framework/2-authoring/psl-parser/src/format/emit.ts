import { ModelAttributeAst } from '../syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../syntax/ast/declarations';
import { type SyntaxElement, SyntaxNode, type SyntaxToken } from '../syntax/red';
import type { TokenKind } from '../tokenizer';

/**
 * Emission reads structure from the typed AST and prints it as tokens.
 *
 * Each construct has its own emit function (`emitModel`, `emitField`,
 * `emitFieldAttribute`, …) that reaches into the AST it understands — a model
 * knows its fields and attributes, a field knows its name / type / attributes —
 * and streams *that node's* tokens through a {@link LineWriter}. The writer owns
 * spacing, indentation, and blank lines; reading the AST is how a function finds
 * the pieces, streaming tokens is how it prints them, so canonical layout lives
 * next to the structure it formats rather than in a single generic machine.
 *
 * Each block construct has its own emit function — {@link emitModel},
 * {@link emitCompositeType}, {@link emitGenericBlock}, {@link emitNamespace},
 * {@link emitTypesBlock} — that walks *its own* children in source order,
 * recognises *its own* member kinds (a model's fields and block attributes, a
 * generic block's key/value entries and block attributes, a namespace's nested
 * declarations, …) and emits each through the matching per-member function. The
 * shared trivia between members (own-line / same-line comments, collapsed blank
 * runs, house-style separation blanks) is placed by {@link emitBlockBody}, a
 * helper each block function calls with a classifier describing *its* members —
 * the layout mechanics are factored out, the member set stays owned by the block.
 *
 * Two facts cannot be read from one construct in isolation, so they are computed
 * up front per block: the alignment column widths (a pure function of the block's
 * field rows, see {@link alignmentColumns}) and the placement of comments and
 * blank lines *between* members. A `//` comment between any two tokens forces a
 * hard break — the comment is written, the line ends, and the continuation is
 * indented one extra level until the construct that opened the break closes it.
 */
export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter(indentUnit, newline);
  emitTopLevel(writer, document);
  return writer.finish();
}

/**
 * Accumulates the emitted output line by line. Indentation is materialised at
 * line start from the current depth; a `//` comment written mid-line forces a
 * {@link newline} plus a continuation {@link indent}, which the construct that
 * opened the break balances with {@link unindent} once it has emitted all of its
 * tokens. Inter-token spacing is applied here from the token kinds, so the
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

  lineOpen(): boolean {
    return this.#lineOpen;
  }

  prevKind(): TokenKind | undefined {
    return this.#prevKind;
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
   * space is inserted iff `space` is true. The caller decides spacing from the
   * structural context it can see (e.g. a qualified name's segments hug).
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

  /** Appends raw text to the current line with no spacing logic. */
  writeRaw(text: string): void {
    this.#line += text;
    this.#lineOpen = true;
  }

  /**
   * Writes a `//`/`///` comment as a hard break: the comment trails the current
   * line (or stands alone if the line is empty), the line ends, and the
   * continuation is indented one extra level. The caller balances the matching
   * {@link unindent} once its construct finishes.
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
 * Streams one AST node's significant tokens (and any interior `//` comments) in
 * source order through the writer. The recursion tracks whether it is inside a
 * qualified name (where segments hug), normalises whitespace/newline trivia to
 * canonical spacing, and routes every comment through the universal break+indent
 * rule. `padTo`, when given, pads the line out to that column *before* the node's
 * first significant token — how a caller that knows its alignment column (e.g.
 * {@link emitField} reaching the type) places the cell boundary explicitly.
 *
 * Returns the number of continuation indents the interior comments pushed; the
 * caller must {@link LineWriter.unindent} that many times once its construct ends.
 */
function streamNode(writer: LineWriter, node: SyntaxNode, padTo?: number): number {
  let continuation = 0;
  let first = true;
  let prevQualified = false;

  const walk = (parent: SyntaxNode, qualified: boolean): void => {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
      if (child.kind === 'Comment') {
        writer.comment(child.text);
        writer.indent();
        continuation += 1;
        prevQualified = false;
        first = false;
        continue;
      }
      const pad = first ? padTo : undefined;
      const space = spaceBetween(writer.prevKind(), child.kind, qualified && prevQualified);
      writer.write(child, space, writer.lineOpen() ? pad : undefined);
      prevQualified = qualified;
      first = false;
    }
  };

  walk(node, false);
  return continuation;
}

/** Pops `count` continuation indents opened by interior comments. */
function closeContinuation(writer: LineWriter, count: number): void {
  for (let i = 0; i < count; i++) writer.unindent();
}

/**
 * A field row: `name<pad>Type<pad>@attr @attr`. Reads the field's name, type
 * annotation, and attributes from the AST and streams that row via
 * {@link streamRow}, which pads the type and first-attribute cells to the block's
 * precomputed columns and routes any interior `//` comment through the universal
 * break. Returns the continuation indents to close.
 */
function emitField(
  writer: LineWriter,
  field: FieldDeclarationAst,
  columns: AlignmentColumns | undefined,
): number {
  return streamRow(writer, field.syntax, columns);
}

/**
 * A `types {}` member: `Name = Type @attr`. Identical row shape to a field with
 * an extra `=` token before the type; {@link streamRow} streams the declaration's
 * children in order, so the `=` falls out with canonical spacing and no separate
 * handling. Named-type rows are never column-aligned. Returns continuation.
 */
function emitNamedType(writer: LineWriter, decl: NamedTypeDeclarationAst): number {
  return streamRow(writer, decl.syntax, undefined);
}

/**
 * Streams a single declaration row (field or named type) by walking the
 * declaration's *direct* children in source order — the one place an interior
 * `//` comment can sit between the type and the first attribute, which is why the
 * walk is over direct children rather than per-sub-node. The type annotation cell
 * pads to `columns.typeColumn` and the first field attribute to
 * `columns.attributeColumn`; once an interior comment has broken the line, the
 * remaining attributes drop onto fresh continuation lines instead of aligning.
 * Comments nested deeper (inside an attribute arg list) are caught by
 * {@link streamNode}'s recursion. Returns the continuation indents to close.
 */
function streamRow(
  writer: LineWriter,
  row: SyntaxNode,
  columns: AlignmentColumns | undefined,
): number {
  let continuation = 0;
  let sawAttribute = false;

  for (const child of row.children()) {
    if (child instanceof SyntaxNode) {
      let padTo: number | undefined;
      if (child.kind === 'TypeAnnotation' && continuation === 0) {
        padTo = columns?.typeColumn;
      } else if (child.kind === 'FieldAttribute') {
        if (continuation > 0) writer.newline();
        else if (!sawAttribute) padTo = columns?.attributeColumn;
        sawAttribute = true;
      }
      continuation += streamNode(writer, child, padTo);
      continue;
    }
    if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
    if (child.kind === 'Comment') {
      writer.comment(child.text);
      writer.indent();
      continuation += 1;
      continue;
    }
    const space = spaceBetween(writer.prevKind(), child.kind, false);
    writer.write(child, space);
  }

  return continuation;
}

/** A `@@attr` block attribute on its own line. Returns continuation to close. */
function emitBlockAttribute(writer: LineWriter, attribute: ModelAttributeAst): number {
  return streamNode(writer, attribute.syntax);
}

/** A generic-block entry: `key = value`. Returns continuation to close. */
function emitKeyValue(writer: LineWriter, pair: KeyValuePairAst): number {
  return streamNode(writer, pair.syntax);
}

/**
 * How a block tells {@link emitBlockBody} to handle one of *its* members: which
 * separation category it falls into (so the shared trivia walk can place the
 * house-style blank) and how to print it (the per-member function the block
 * picked for that kind). Each block builds these from its own typed members, so
 * the member set — not a generic dispatcher — stays owned by the block function.
 */
type MemberCategory = 'regular' | 'blockAttribute' | 'nestedBlock';

interface BlockMember {
  readonly category: MemberCategory;
  /**
   * Prints the member's tokens and terminates its line — trailing the given
   * same-line `//` comment when present, otherwise ending the line plainly — and
   * returns the continuation indents the region walk must close afterwards.
   */
  emit(trailing: string | undefined): number;
}

/**
 * Wraps a per-member function as a leaf {@link BlockMember}: print the row, then
 * trail its same-line comment (or end the line) before the caller closes the
 * continuation it returned. Block attributes and entries share this terminator;
 * only nested blocks terminate themselves.
 */
function leafMember(
  writer: LineWriter,
  category: MemberCategory,
  print: () => number,
): BlockMember {
  return {
    category,
    emit(trailing) {
      const continuation = print();
      if (trailing !== undefined) writer.comment(trailing);
      else writer.newline();
      return continuation;
    },
  };
}

/**
 * Maps one of a block's child nodes to a {@link BlockMember}, or `undefined` when
 * the child is not one of this block's member kinds. This is the function each
 * block function supplies to {@link emitBlockBody}; it is where a block names the
 * member kinds it owns and the per-member function each is printed with.
 */
type MemberClassifier = (node: SyntaxNode) => BlockMember | undefined;

/** `model Name {` — fields and block attributes, then `}`. */
function emitModel(
  writer: LineWriter,
  model: ModelDeclarationAst,
  trailing: string | undefined,
): void {
  const columns = alignmentMap(model.syntax);
  emitBlockBody(writer, model.syntax, trailing, (node) => {
    const field = FieldDeclarationAst.cast(node);
    if (field)
      return leafMember(writer, 'regular', () =>
        emitField(writer, field, columns.get(node.offset)),
      );
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

/** `type Name {` — fields and block attributes, then `}`. */
function emitCompositeType(
  writer: LineWriter,
  composite: CompositeTypeDeclarationAst,
  trailing: string | undefined,
): void {
  const columns = alignmentMap(composite.syntax);
  emitBlockBody(writer, composite.syntax, trailing, (node) => {
    const field = FieldDeclarationAst.cast(node);
    if (field)
      return leafMember(writer, 'regular', () =>
        emitField(writer, field, columns.get(node.offset)),
      );
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

/** `keyword Name {` (enum / datasource / generator) — key/value entries and block attributes, then `}`. */
function emitGenericBlock(
  writer: LineWriter,
  block: GenericBlockDeclarationAst,
  trailing: string | undefined,
): void {
  emitBlockBody(writer, block.syntax, trailing, (node) => {
    const entry = KeyValuePairAst.cast(node);
    if (entry) return leafMember(writer, 'regular', () => emitKeyValue(writer, entry));
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

/** `namespace Name {` — nested declarations (models / composite types / generic blocks), then `}`. */
function emitNamespace(
  writer: LineWriter,
  namespace: NamespaceDeclarationAst,
  trailing: string | undefined,
): void {
  emitBlockBody(writer, namespace.syntax, trailing, (node) => {
    const declaration = castBlockDeclaration(node);
    if (declaration) return nestedBlockMember(writer, declaration);
    return undefined;
  });
}

/** `types {` — named-type declarations, then `}`. */
function emitTypesBlock(
  writer: LineWriter,
  block: TypesBlockAst,
  trailing: string | undefined,
): void {
  emitBlockBody(writer, block.syntax, trailing, (node) => {
    const named = NamedTypeDeclarationAst.cast(node);
    if (named) return leafMember(writer, 'regular', () => emitNamedType(writer, named));
    return undefined;
  });
}

/**
 * The document body: a sequence of top-level declarations (every one a block) with
 * the same inter-member trivia as a block interior, but no surrounding braces. The
 * walk reads the document's heterogeneous declarations — a thin cast-dispatch to
 * each block's emit function — and lets {@link walkRegion} place the blanks and
 * comments between them.
 */
function emitTopLevel(writer: LineWriter, document: DocumentAst): void {
  walkRegion(writer, Array.from(document.syntax.children()), undefined, (node) => {
    const declaration = castTopLevelDeclaration(node);
    if (declaration) return nestedBlockMember(writer, declaration);
    return undefined;
  });
}

/**
 * A bound emitter for one nested block — prints the block, carrying its own
 * `} // trailing` same-line comment into its close (a block owns its closing
 * line, so it cannot be terminated by the region walk like a leaf member). Used
 * by the namespace / document classifiers so they recognise *which* block kinds
 * are valid in their position without re-implementing each block's emission.
 */
type BlockEmitter = (writer: LineWriter, trailing: string | undefined) => void;

/**
 * Wraps a nested block's emitter as a {@link BlockMember}: the block writes its
 * own closing line (carrying any `} // trailing` comment) and balances its own
 * continuation indents, so it leaves none for the region walk to close.
 */
function nestedBlockMember(writer: LineWriter, block: BlockEmitter): BlockMember {
  return {
    category: 'nestedBlock',
    emit(trailing) {
      block(writer, trailing);
      return 0;
    },
  };
}

function castBlockDeclaration(node: SyntaxNode): BlockEmitter | undefined {
  const model = ModelDeclarationAst.cast(node);
  if (model) return (writer, trailing) => emitModel(writer, model, trailing);
  const composite = CompositeTypeDeclarationAst.cast(node);
  if (composite) return (writer, trailing) => emitCompositeType(writer, composite, trailing);
  const generic = GenericBlockDeclarationAst.cast(node);
  if (generic) return (writer, trailing) => emitGenericBlock(writer, generic, trailing);
  return undefined;
}

function castTopLevelDeclaration(node: SyntaxNode): BlockEmitter | undefined {
  const block = castBlockDeclaration(node);
  if (block) return block;
  const namespace = NamespaceDeclarationAst.cast(node);
  if (namespace) return (writer, trailing) => emitNamespace(writer, namespace, trailing);
  const types = TypesBlockAst.cast(node);
  if (types) return (writer, trailing) => emitTypesBlock(writer, types, trailing);
  return undefined;
}

/**
 * Emits a block's `keyword [Name] {` header, its body, and its closing `}`. The
 * caller supplies a {@link MemberClassifier} naming the member kinds it owns;
 * this helper streams the header tokens, carries a same-line `{ // header`
 * comment, walks the body at one deeper indent via {@link walkRegion}, and closes
 * with `}` carrying the comment that trailed it on the same source line. The
 * shared header + trivia mechanics live here; the member set stays with the block.
 */
function emitBlockBody(
  writer: LineWriter,
  node: SyntaxNode,
  closingTrailing: string | undefined,
  classify: MemberClassifier,
): void {
  const children = Array.from(node.children());
  const openIndex = children.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');

  streamHeader(writer, node);
  const headerComment = sameLineCommentAfter(children, openIndex);
  if (headerComment !== undefined) writer.comment(headerComment);
  else writer.newline();

  writer.indent();
  walkRegion(writer, children, 'RBrace', classify);
  writer.unindent();

  writer.writeRaw('}');
  if (closingTrailing !== undefined) writer.comment(closingTrailing);
  else writer.newline();
}

/**
 * Streams a block's header tokens (keyword, optional name) up to and including
 * the opening `{`, recursing into the name's `Identifier` node so the name lands
 * between the keyword and the brace. Header names are never qualified, so the
 * plain inter-token spacing table applies with no qualified-name hugging.
 */
function streamHeader(writer: LineWriter, node: SyntaxNode): void {
  let done = false;
  const walk = (parent: SyntaxNode): void => {
    for (const child of parent.children()) {
      if (done) return;
      if (child instanceof SyntaxNode) {
        walk(child);
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline' || child.kind === 'Comment') {
        continue;
      }
      const space = spaceBetween(writer.prevKind(), child.kind, false);
      writer.write(child, space);
      if (child.kind === 'LBrace') {
        done = true;
        return;
      }
    }
  };
  walk(node);
}

/**
 * Walks a region's children in source order — a block interior up to its closing
 * `}`, or the document body — placing the comments and blank lines the block's
 * member emitters cannot see. The block-supplied {@link MemberClassifier} decides
 * which children are members and how each prints (and which separation category
 * it falls into); this walk owns only the trivia *between* members:
 *
 *   - an own-line comment (preceded by a newline) writes on its own line;
 *   - a same-line comment trails the member just written;
 *   - a run of ≥2 newlines between members collapses to one blank;
 *   - a nested block, and the first block attribute after a regular member, get
 *     one house-style blank.
 *
 * A leading comment run attaches to the member it precedes and carries that
 * member's separation blank, so the blank lands before the comment. `closeKind`
 * is `RBrace` for a block (the walk skips up to and including the opening `{`,
 * whose header {@link emitBlockBody} already wrote) and `undefined` for the
 * document.
 */
function walkRegion(
  writer: LineWriter,
  elements: readonly SyntaxElement[],
  closeKind: 'RBrace' | undefined,
  classify: MemberClassifier,
): void {
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
      const member = classify(element);
      if (member === undefined) continue;
      if (!ledByComment) {
        if (newlines >= 2 && sawContent && !writer.lastIsBlank()) writer.blank();
        else if (separationBlankWanted(writer, member.category, sawContent, lastWasRegular)) {
          writer.blank();
        }
      }

      const trailing = sameLineTrailingComment(elements, i);
      closeContinuation(writer, member.emit(trailing.text));
      if (trailing.index !== undefined) i = trailing.index;
      sawContent = true;
      lastWasRegular = member.category !== 'blockAttribute';
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
        const led = leadingMemberAfter(elements, i, classify);
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
 * Whether the house style places a blank before a member of `category`: one
 * before a nested block, and one before the first block attribute that follows a
 * regular member. Decided from the writer's current state and the last member's
 * kind — the categories are assigned by each block's own classifier.
 */
function separationBlankWanted(
  writer: LineWriter,
  category: MemberCategory,
  sawContent: boolean,
  lastWasRegular: boolean,
): boolean {
  if (!sawContent || writer.lastIsBlank()) return false;
  if (category === 'nestedBlock') return true;
  return category === 'blockAttribute' && lastWasRegular;
}

/**
 * The separation category of the member a leading comment at `commentIndex`
 * precedes — the next member reached by skipping intervening own-line comments and
 * trivia, or `undefined` when the comment dangles (the region closes first). A
 * pure forward scan that buffers no output; it only locates the category whose
 * separation blank the leading comment carries, using the block's own classifier.
 */
function leadingMemberAfter(
  elements: readonly SyntaxElement[],
  commentIndex: number,
  classify: MemberClassifier,
): MemberCategory | undefined {
  for (let i = commentIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) return classify(element)?.category;
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

interface AlignmentColumns {
  readonly typeColumn: number;
  readonly attributeColumn: number;
}

/**
 * A block's alignment pre-pass: groups consecutive single-line field rows into
 * runs (broken by a blank, an own-line comment, an interior comment, a leading
 * comment on the row, or any non-field member) and maps each field node to its
 * run's column widths. Widths are a pure function of the rows' ASTs (the rendered
 * name and type cells) — the only look-ahead in emission; no rendered output is
 * buffered, the block's walk looks the columns up when it reaches each field.
 */
function alignmentMap(block: SyntaxNode): Map<number, AlignmentColumns> {
  const map = new Map<number, AlignmentColumns>();
  let sawOpenBrace = false;
  let newlines = 0;
  let leadingComment = false;
  let run: SyntaxNode[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const columns = alignmentColumns(run);
    for (const node of run) map.set(node.offset, columns);
    run = [];
  };

  for (const element of block.children()) {
    if (element instanceof SyntaxNode) {
      if (!sawOpenBrace) continue;
      const alignable =
        FieldDeclarationAst.cast(element) !== undefined && !hasInteriorComment(element);
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
    if (element.kind === 'LBrace' && !sawOpenBrace) {
      sawOpenBrace = true;
      newlines = 0;
      continue;
    }
    if (!sawOpenBrace) continue;
    if (element.kind === 'RBrace') break;
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
 * Whether a field carries a `//` comment before its closing boundary — the
 * interior-comment break that pulls the row out of an alignment run (its
 * continuation attributes drop to their own indented lines).
 */
function hasInteriorComment(node: SyntaxNode): boolean {
  for (const token of node.tokens()) {
    if (token.kind === 'Comment') return true;
  }
  return false;
}

/**
 * The canonical text of a sub-tree's significant tokens with spacing applied —
 * used only to measure alignment column widths in the pre-pass, never to emit
 * (emission streams tokens through the writer).
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
