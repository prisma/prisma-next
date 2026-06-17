import {
  type AttributeArgListAst,
  type FieldAttributeAst,
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

  join(indentUnit: string, newline: string): string {
    const body = this.#lines
      .map((line) => (line.blank ? '' : `${indentUnit.repeat(line.depth)}${line.text}`))
      .join(newline);
    return body.length > 0 ? `${body}${newline}` : '';
  }
}

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter();
  emitRegion(writer, Array.from(document.syntax.children()), 0);
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
 * Walks a region's elements (a block body between its braces, or the whole
 * document) in source order and reduces the interleaved significant nodes and
 * trivia tokens into a member/blank sequence. Own-line comments attach as a
 * member's `leading`; a same-line comment attaches as the preceding member's
 * `trailing`; a run of one or more blank lines between members collapses to a
 * single `blank`, never directly after the opening boundary nor before the
 * closing one. Own-line comments left over after the last member (with no
 * construct to attach to) surface as trailing `comment` items, preserving a
 * single collapsed blank line that preceded them.
 */
function sequenceRegion(elements: readonly SyntaxElement[]): Item[] {
  const items: Item[] = [];
  let leading: string[] = [];
  let blankPending = false;
  let sawContent = false;
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
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Newline') {
      newlines += 1;
      continue;
    }
    if (element.kind === 'Comment') {
      const last = items.at(-1);
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
    if (blankPending) items.push({ kind: 'blank' });
    for (const comment of leading) items.push({ kind: 'comment', text: comment });
  }
  return items;
}

function emitRegion(writer: LineWriter, elements: readonly SyntaxElement[], depth: number): void {
  const items = sequenceRegion(elements);
  let pendingRows: MemberItem[] = [];

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
    const row = toAlignmentRow(item.node);
    if (row && item.leading.length === 0) {
      pendingRows.push(item);
      continue;
    }
    flushRows();
    for (const comment of item.leading) writer.push(depth, comment);
    emitMember(writer, item, depth);
  }
  flushRows();
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
 * the closing line carries. The body recurses through {@link emitRegion} so
 * nested trivia is preserved at the deeper indent.
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
  writer.push(depth, withTrailing(header, headerTrailingComment(node)));
  emitRegion(writer, blockBodyElements(node), depth + 1);
  writer.push(depth, withTrailing('}', closingTrailing));
}

/**
 * The elements of a block's body: everything strictly between the opening
 * `LBrace` and the closing `RBrace`. Trivia outside the braces (the header's
 * own leading comment, the blank line after the block) belongs to the enclosing
 * region, not the body.
 */
function blockBodyElements(node: SyntaxNode): SyntaxElement[] {
  const elements = Array.from(node.children());
  const open = elements.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');
  let close = -1;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el && !(el instanceof SyntaxNode) && el.kind === 'RBrace') {
      close = i;
      break;
    }
  }
  if (open === -1) return [];
  const end = close === -1 ? elements.length : close;
  return elements.slice(bodyStart(elements, open), end);
}

/**
 * The index where a block body's emittable elements begin: just past the
 * opening `LBrace`, skipping a same-line header comment (whitespace then a
 * comment with no intervening newline). That comment is rendered on the header
 * line by {@link headerTrailingComment}, so it must not also surface as the
 * first member's leading comment.
 */
function bodyStart(elements: readonly SyntaxElement[], open: number): number {
  let index = open + 1;
  while (index < elements.length) {
    const el = elements[index];
    if (el && !(el instanceof SyntaxNode) && el.kind === 'Whitespace') {
      index += 1;
      continue;
    }
    if (el && !(el instanceof SyntaxNode) && el.kind === 'Comment') {
      return index + 1;
    }
    break;
  }
  return open + 1;
}

/**
 * A same-line comment that trails a block header is attached (per the parser's
 * trivia discipline) inside the block node, between the `LBrace` and the first
 * body member, with no intervening newline. Surfaced here so the header line
 * can carry it.
 */
function headerTrailingComment(node: SyntaxNode): string | undefined {
  let pastBrace = false;
  for (const el of node.children()) {
    if (el instanceof SyntaxNode) {
      if (pastBrace) return undefined;
      continue;
    }
    if (el.kind === 'LBrace') {
      pastBrace = true;
      continue;
    }
    if (!pastBrace) continue;
    if (el.kind === 'Whitespace') continue;
    if (el.kind === 'Newline') return undefined;
    if (el.kind === 'Comment') return el.text;
    return undefined;
  }
  return undefined;
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
  const prefix = space ? `${space}:` : namespace ? `${namespace}.` : '';
  return `${prefix}${name}`;
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
  return `${emitQualifiedName(call.qualifiedName())}(${args})`;
}

function identifierText(identifier: IdentifierAst | undefined): string {
  return identifier?.token()?.text ?? '';
}

function joinTokens(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(' ');
}
