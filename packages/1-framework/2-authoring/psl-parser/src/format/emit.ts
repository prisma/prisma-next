import {
  type AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from '../syntax/ast/attributes';
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
import type { AttributeArgAst, ExpressionAst } from '../syntax/ast/expressions';
import {
  ArrayLiteralAst,
  BooleanLiteralExprAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../syntax/ast/expressions';
import { IdentifierAst } from '../syntax/ast/identifier';
import type { QualifiedNameAst } from '../syntax/ast/qualified-name';
import type { TypeAnnotationAst } from '../syntax/ast/type-annotation';
import { type SyntaxElement, SyntaxNode } from '../syntax/red';

/**
 * Accumulates emitted lines paired with their nesting depth. The depth is
 * materialised into leading indentation only when the lines are joined, so the
 * resolved indent unit and newline live entirely at the join step. A line
 * tagged `blank` carries no indentation regardless of depth.
 */
class LineWriter {
  readonly #lines: { readonly depth: number; readonly text: string; readonly blank: boolean }[] =
    [];

  push(depth: number, text: string): void {
    this.#lines.push({ depth, text, blank: false });
  }

  blank(): void {
    this.#lines.push({ depth: 0, text: '', blank: true });
  }

  lastIsBlank(): boolean {
    return this.#lines.at(-1)?.blank ?? false;
  }

  hasContent(): boolean {
    return this.#lines.length > 0;
  }

  join(indentUnit: string, newline: string): string {
    const body = this.#lines
      .map((line) => (line.blank ? '' : `${indentUnit.repeat(line.depth)}${line.text}`))
      .join(newline);
    return body.length > 0 ? `${body}${newline}` : '';
  }
}

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter();
  emitItems(writer, sequenceRegion(Array.from(document.syntax.children())).items, 0);
  return writer.join(indentUnit, newline);
}

/**
 * A member of a block or document, paired with the inter-construct trivia the
 * emitter reattaches to it: own-line comment lines that immediately precede it
 * (`leading`) and a comment that trails it on the same source line
 * (`trailing`).
 */
interface MemberItem {
  readonly kind: 'member';
  readonly node: SyntaxNode;
  readonly leading: readonly string[];
  trailing: string | undefined;
}

interface BlankItem {
  readonly kind: 'blank';
}

/**
 * An own-line comment line that trails the last member of a region with no
 * construct after it, sitting between that member and the region's closing
 * token (`}` for a block, EOF for the document). It carries no member to attach
 * to, so it surfaces as its own item rendered at the region's member indent.
 */
interface DanglingCommentItem {
  readonly kind: 'comment';
  readonly text: string;
}

type Item = MemberItem | BlankItem | DanglingCommentItem;

/**
 * The result of the single source-order pass over a region: the comment that
 * trailed the region's opening boundary on the same source line (a block
 * header's `{ // ...` comment, `undefined` for the document or a braceless
 * header) plus the member/blank/dangling-comment sequence that follows.
 */
interface Region {
  readonly headerComment: string | undefined;
  readonly items: Item[];
}

/**
 * Walks a region's elements in source order exactly once and reduces the
 * interleaved significant nodes and trivia tokens into a member/blank sequence,
 * plus the region's optional header same-line comment. The region is either the
 * whole document (no braces) or a block interior delimited by its `{`/`}` — for
 * the latter the brace tokens are passed in so the one pass can recognise the
 * boundaries without a separate walk.
 *
 * Own-line comments attach as a member's `leading`; a same-line comment
 * attaches as the preceding member's `trailing`; a same-line comment trailing
 * the opening `{` (the `{ // ...` case, before any member) attaches as
 * `headerComment`; a run of one or more blank lines between members collapses
 * to a single `blank`, never directly after the opening boundary nor before the
 * closing one. Own-line comments left over after the last member (with no
 * construct to attach to) surface as trailing `comment` items, preserving a
 * single collapsed blank line that preceded them.
 */
function sequenceRegion(elements: readonly SyntaxElement[]): Region {
  const items: Item[] = [];
  let headerComment: string | undefined;
  let leading: string[] = [];
  let blankPending = false;
  let sawContent = false;
  let sawOpenBrace = false;
  let newlines = 0;

  for (const element of elements) {
    if (element instanceof SyntaxNode) {
      if (newlines >= 2 && sawContent && leading.length === 0) blankPending = true;
      if (blankPending) {
        items.push({ kind: 'blank' });
        blankPending = false;
      }
      items.push({ kind: 'member', node: element, leading, trailing: undefined });
      leading = [];
      sawContent = true;
      newlines = 0;
      continue;
    }
    if (element.kind === 'LBrace' && !sawOpenBrace) {
      sawOpenBrace = true;
      continue;
    }
    if (element.kind === 'RBrace') break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Newline') {
      newlines += 1;
      continue;
    }
    if (element.kind === 'Comment') {
      const last = items.at(-1);
      if (sawOpenBrace && newlines === 0 && !sawContent && headerComment === undefined) {
        headerComment = element.text;
      } else if (newlines === 0 && last?.kind === 'member' && last.trailing === undefined) {
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
    if (blankPending) items.push({ kind: 'blank' });
    for (const comment of leading) items.push({ kind: 'comment', text: comment });
  }
  return { headerComment, items };
}

/**
 * Renders the sequenced items of one region. All inter-member trivia is already
 * resolved into the items by {@link sequenceRegion} (the single source-order
 * pass); this step only decides line layout: aligned-row runs, the house-style
 * blank before a block attribute, and the one trivia case that is *not*
 * inter-member — the {@link inlineBreakComment} barrier, which is interior to a
 * single declaration and so splits that member across lines rather than
 * attaching to a position between members.
 */
function emitItems(writer: LineWriter, items: readonly Item[], depth: number): void {
  let pendingRows: MemberItem[] = [];
  let lastMemberWasRegular = false;

  const flushRows = (): void => {
    if (pendingRows.length === 0) return;
    emitAlignedRows(writer, pendingRows, depth);
    pendingRows = [];
  };

  for (const item of items) {
    if (item.kind === 'blank') {
      flushRows();
      writer.blank();
      continue;
    }
    if (item.kind === 'comment') {
      flushRows();
      writer.push(depth, item.text);
      continue;
    }
    const isBlockAttribute = ModelAttributeAst.cast(item.node) !== undefined;
    if (isBlockAttribute && lastMemberWasRegular && writer.hasContent() && !writer.lastIsBlank()) {
      flushRows();
      writer.blank();
    }
    const broken = inlineBreakComment(item.node);
    if (broken) {
      flushRows();
      for (const comment of item.leading) writer.push(depth, comment);
      emitBrokenMember(writer, broken, depth, item.trailing);
      lastMemberWasRegular = !isBlockAttribute;
      continue;
    }
    const row = toAlignmentRow(item.node);
    if (row && item.leading.length === 0) {
      pendingRows.push(item);
      lastMemberWasRegular = true;
      continue;
    }
    flushRows();
    for (const comment of item.leading) writer.push(depth, comment);
    emitMember(writer, item, depth);
    lastMemberWasRegular = !isBlockAttribute;
  }
  flushRows();
}

/**
 * A member whose declaration broke at a same-line `//` comment, split into the
 * head line text (its name+type, with the comment appended) and the continuation
 * attributes that followed on later source lines.
 */
interface InlineBreak {
  readonly head: string;
  readonly comment: string;
  readonly attributes: readonly string[];
}

/**
 * Detects a same-line `//` comment acting as a hard break barrier inside a
 * field or named-type declaration: the head ran to a `//` comment and the
 * `@attribute`s continued on later lines. A `//` comment runs to end-of-line,
 * so the emitter must preserve the break rather than hoist the attributes up
 * onto the comment line (which would both swallow them into the comment and
 * relocate the comment off the token it documents — an idempotence hazard).
 * Returns `undefined` when no such barrier is present (the common case), so the
 * member renders through its normal single-line path.
 *
 * This is the one comment the source-order region pass deliberately does not
 * own: it is *intra-declaration* trivia (a child of the member node, between
 * the type and its attributes), not inter-member trivia positioned between
 * sibling members. The region pass's `leading`/`trailing`/`headerComment`
 * attachment model cannot express "a comment that splits one member across
 * lines," so this stays a separate look inside the member node.
 */
function inlineBreakComment(node: SyntaxNode): InlineBreak | undefined {
  const field = FieldDeclarationAst.cast(node);
  const named = NamedTypeDeclarationAst.cast(node);
  if (!field && !named) return undefined;

  let comment: string | undefined;
  let sawNewline = false;
  let sawAttribute = false;
  for (const child of node.children()) {
    if (child instanceof SyntaxNode) {
      if (FieldAttributeAst.cast(child)) sawAttribute = true;
      continue;
    }
    if (sawAttribute) continue;
    if (child.kind === 'Comment') comment = child.text;
    else if (child.kind === 'Newline' && comment !== undefined) sawNewline = true;
  }
  if (comment === undefined || !sawNewline || !sawAttribute) return undefined;

  if (field) {
    return {
      head: joinTokens([identifierText(field.name()), emitTypeAnnotation(field.typeAnnotation())]),
      comment,
      attributes: Array.from(field.attributes(), emitFieldAttribute),
    };
  }
  if (named) {
    return {
      head: joinTokens([
        identifierText(named.name()),
        '=',
        emitTypeAnnotation(named.typeAnnotation()),
      ]),
      comment,
      attributes: Array.from(named.attributes(), emitFieldAttribute),
    };
  }
  return undefined;
}

/**
 * Renders a member whose declaration broke at a same-line comment: the head
 * (with the comment) on its own line at `depth`, then each continuation
 * attribute on its own line at the field-continuation indent (`depth + 1`).
 */
function emitBrokenMember(
  writer: LineWriter,
  broken: InlineBreak,
  depth: number,
  trailing: string | undefined,
): void {
  writer.push(depth, withTrailing(`${broken.head} ${broken.comment}`, trailing));
  for (const attribute of broken.attributes) writer.push(depth + 1, attribute);
}

/**
 * Renders a single non-row member (block attribute, named type, key/value, or a
 * nested block) with its trailing comment appended. Row-kind members (fields,
 * enum values) flow through {@link emitAlignedRows} instead.
 */
function emitMember(writer: LineWriter, item: MemberItem, depth: number): void {
  const node = item.node;
  const block = emitBlockMember(writer, node, depth, item.trailing);
  if (block) return;

  const modelAttribute = ModelAttributeAst.cast(node);
  if (modelAttribute) {
    writer.push(depth, withTrailing(emitModelAttribute(modelAttribute), item.trailing));
    return;
  }
  const named = NamedTypeDeclarationAst.cast(node);
  if (named) {
    writer.push(depth, withTrailing(emitNamedType(named), item.trailing));
    return;
  }
  const keyValue = KeyValuePairAst.cast(node);
  if (keyValue) {
    writer.push(depth, withTrailing(emitKeyValue(keyValue), item.trailing));
    return;
  }
  const row = toAlignmentRow(node);
  if (row) {
    writer.push(depth, withTrailing(renderAlignedRow(row, row.name.length, 0), item.trailing));
  }
}

/**
 * Renders a member that is itself a block (model / composite type / enum /
 * namespace / `types` / generic). Returns `true` when handled. The header line
 * carries the block's own header same-line comment; `closingTrailing` is the
 * comment that trailed the member's closing `}` on the same source line, which
 * the closing line carries. The body recurses through {@link emitBlock} — and
 * thence the single {@link sequenceRegion} pass — so nested trivia is preserved
 * at the deeper indent.
 */
function emitBlockMember(
  writer: LineWriter,
  node: SyntaxNode,
  depth: number,
  closingTrailing: string | undefined,
): boolean {
  const model = ModelDeclarationAst.cast(node);
  if (model) {
    emitNamedBlock(writer, depth, 'model', model.name(), node, closingTrailing);
    return true;
  }
  const composite = CompositeTypeDeclarationAst.cast(node);
  if (composite) {
    emitNamedBlock(writer, depth, 'type', composite.name(), node, closingTrailing);
    return true;
  }
  const namespace = NamespaceDeclarationAst.cast(node);
  if (namespace) {
    emitNamedBlock(writer, depth, 'namespace', namespace.name(), node, closingTrailing);
    return true;
  }
  const typesBlock = TypesBlockAst.cast(node);
  if (typesBlock) {
    emitBlock(writer, depth, 'types {', node, closingTrailing);
    return true;
  }
  const generic = GenericBlockDeclarationAst.cast(node);
  if (generic) {
    emitNamedBlock(
      writer,
      depth,
      generic.keyword()?.text ?? '',
      generic.name(),
      node,
      closingTrailing,
    );
    return true;
  }
  return false;
}

function emitNamedBlock(
  writer: LineWriter,
  depth: number,
  keyword: string,
  name: IdentifierAst | undefined,
  node: SyntaxNode,
  closingTrailing: string | undefined,
): void {
  emitBlock(writer, depth, blockHeader(keyword, name), node, closingTrailing);
}

function emitBlock(
  writer: LineWriter,
  depth: number,
  header: string,
  node: SyntaxNode,
  closingTrailing: string | undefined,
): void {
  const { headerComment, items } = sequenceRegion(blockInterior(node));
  writer.push(depth, withTrailing(header, headerComment));
  emitItems(writer, items, depth + 1);
  writer.push(depth, withTrailing('}', closingTrailing));
}

/**
 * A block node's interior, brace-delimited: the elements from the opening
 * `LBrace` through the closing `RBrace` (inclusive). The braces are kept so the
 * single {@link sequenceRegion} pass can recognise the boundaries itself — it
 * surfaces a same-line comment trailing the `{` as the region's `headerComment`
 * and stops at the `}`, with no separate header-comment or body-start walk.
 * Trivia outside the braces (the header's own leading comment, the blank line
 * after the block) belongs to the enclosing region, not the interior.
 */
function blockInterior(node: SyntaxNode): SyntaxElement[] {
  const elements = Array.from(node.children());
  const open = elements.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');
  if (open === -1) return [];
  let close = elements.length;
  for (let i = elements.length - 1; i > open; i--) {
    const el = elements[i];
    if (el && !(el instanceof SyntaxNode) && el.kind === 'RBrace') {
      close = i + 1;
      break;
    }
  }
  return elements.slice(open, close);
}

function blockHeader(keyword: string, name: IdentifierAst | undefined): string {
  const named = identifierText(name);
  return named ? `${keyword} ${named} {` : `${keyword} {`;
}

/**
 * One field's contribution to a block's alignment table: the left-hand
 * `name` / `type` cells plus the single right-hand `attributes` cell. Both
 * the type column and the attribute column are aligned per block: the type
 * starts one space past the widest name, and the attributes start one space
 * past the widest name+type cell.
 */
interface AlignmentRow {
  readonly name: string;
  readonly type: string;
  readonly attributes: string;
  readonly trailing: string | undefined;
}

function toAlignmentRow(node: SyntaxNode): AlignmentRow | undefined {
  const field = FieldDeclarationAst.cast(node);
  if (field) {
    return {
      name: identifierText(field.name()),
      type: emitTypeAnnotation(field.typeAnnotation()),
      attributes: Array.from(field.attributes(), emitFieldAttribute).join(' '),
      trailing: undefined,
    };
  }
  return undefined;
}

function emitAlignedRows(writer: LineWriter, items: readonly MemberItem[], depth: number): void {
  const rows = items.map<AlignmentRow>((item) => {
    const base = toAlignmentRow(item.node);
    return base ? { ...base, trailing: item.trailing } : emptyRow();
  });
  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length));
  const typeColumnEnd = Math.max(
    0,
    ...rows.map((row) => (row.type.length > 0 ? nameWidth + 1 + row.type.length : row.name.length)),
  );
  for (const row of rows) {
    writer.push(depth, withTrailing(renderAlignedRow(row, nameWidth, typeColumnEnd), row.trailing));
  }
}

function emptyRow(): AlignmentRow {
  return { name: '', type: '', attributes: '', trailing: undefined };
}

function renderAlignedRow(row: AlignmentRow, nameWidth: number, typeColumnEnd: number): string {
  let line = row.name;
  if (row.type.length > 0) {
    line = `${row.name.padEnd(nameWidth)} ${row.type}`;
  }
  if (row.attributes.length > 0) {
    line = `${line.padEnd(typeColumnEnd)} ${row.attributes}`;
  }
  return line;
}

function withTrailing(line: string, trailing: string | undefined): string {
  return trailing === undefined ? line : `${line} ${trailing}`;
}

function emitNamedType(named: NamedTypeDeclarationAst): string {
  const parts = [identifierText(named.name()), '=', emitTypeAnnotation(named.typeAnnotation())];
  for (const attribute of named.attributes()) parts.push(emitFieldAttribute(attribute));
  return joinTokens(parts);
}

function emitKeyValue(entry: KeyValuePairAst): string {
  const key = identifierText(entry.key());
  if (!entry.equals()) return key;
  return joinTokens([key, '=', emitExpression(entry.value())]);
}

/**
 * Reassembles a `[space ':']? [namespace '.']? name` qualified name from its
 * segments. The one place every qualified position (type reference, constructor
 * callee, attribute name) is rendered back to text.
 */
function emitQualifiedName(qualified: QualifiedNameAst | undefined): string {
  if (!qualified) return '';
  const space = identifierText(qualified.space());
  const namespace = identifierText(qualified.namespace());
  const name = identifierText(qualified.identifier());
  const spacePrefix = space ? `${space}:` : '';
  const namespacePrefix = namespace ? `${namespace}.` : '';
  return `${spacePrefix}${namespacePrefix}${name}`;
}

function emitTypeAnnotation(annotation: TypeAnnotationAst | undefined): string {
  if (!annotation) return '';
  let base = emitQualifiedName(annotation.name());
  if (annotation.isConstructor()) base += emitArgList(annotation.argList());
  if (annotation.isList()) base += '[]';
  if (annotation.isOptional()) base += '?';
  return base;
}

function emitFieldAttribute(attribute: FieldAttributeAst): string {
  return `@${emitQualifiedName(attribute.name())}${emitArgList(attribute.argList())}`;
}

function emitModelAttribute(attribute: ModelAttributeAst): string {
  return `@@${emitQualifiedName(attribute.name())}${emitArgList(attribute.argList())}`;
}

function emitArgList(argList: AttributeArgListAst | undefined): string {
  if (!argList) return '';
  const args = Array.from(argList.args(), emitAttributeArg).join(', ');
  return `(${args})`;
}

function emitAttributeArg(arg: AttributeArgAst): string {
  const name = identifierText(arg.name());
  const value = emitExpression(arg.value());
  return name ? `${name}: ${value}` : value;
}

function emitExpression(expression: ExpressionAst | undefined): string {
  if (!expression) return '';
  const fn = FunctionCallAst.cast(expression.syntax);
  if (fn) return emitFunctionCall(fn);
  const array = ArrayLiteralAst.cast(expression.syntax);
  if (array) return `[${Array.from(array.elements(), emitExpression).join(', ')}]`;
  const object = ObjectLiteralExprAst.cast(expression.syntax);
  if (object) {
    const fields = Array.from(
      object.fields(),
      (objField) => `${identifierText(objField.key())}: ${emitExpression(objField.value())}`,
    ).join(', ');
    return `{ ${fields} }`;
  }
  const str = StringLiteralExprAst.cast(expression.syntax);
  if (str) return str.token()?.text ?? '';
  const num = NumberLiteralExprAst.cast(expression.syntax);
  if (num) return num.token()?.text ?? '';
  const bool = BooleanLiteralExprAst.cast(expression.syntax);
  if (bool) return bool.token()?.text ?? '';
  const ident = IdentifierAst.cast(expression.syntax);
  if (ident) return identifierText(ident);
  return '';
}

function emitFunctionCall(call: FunctionCallAst): string {
  const args = Array.from(call.args(), emitAttributeArg).join(', ');
  return `${emitQualifiedName(call.name())}(${args})`;
}

function identifierText(identifier: IdentifierAst | undefined): string {
  return identifier?.token()?.text ?? '';
}

function joinTokens(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(' ');
}
