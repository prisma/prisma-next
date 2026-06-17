import type { FieldAttributeAst, ModelAttributeAst } from '../syntax/ast/attributes';
import type {
  DocumentAst,
  EnumValueDeclarationAst,
  FieldDeclarationAst,
  KeyValuePairAst,
  NamedTypeDeclarationAst,
  NamespaceMemberAst,
} from '../syntax/ast/declarations';
import {
  CompositeTypeDeclarationAst,
  EnumDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
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
import type { TypeAnnotationAst } from '../syntax/ast/type-annotation';

/**
 * Accumulates emitted lines paired with their nesting depth. The depth is
 * materialised into leading indentation only when the lines are joined, so the
 * resolved indent unit and newline live entirely at the join step.
 */
class LineWriter {
  readonly #lines: { readonly depth: number; readonly text: string }[] = [];

  push(depth: number, text: string): void {
    this.#lines.push({ depth, text });
  }

  join(indentUnit: string, newline: string): string {
    const body = this.#lines
      .map((line) => `${indentUnit.repeat(line.depth)}${line.text}`)
      .join(newline);
    return body.length > 0 ? `${body}${newline}` : '';
  }
}

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter();
  for (const declaration of document.declarations()) {
    emitDeclaration(writer, declaration, 0);
  }
  return writer.join(indentUnit, newline);
}

type TopLevelDeclarationAst = NamespaceMemberAst | TypesBlockAst | NamespaceDeclarationAst;

function emitDeclaration(
  writer: LineWriter,
  declaration: TopLevelDeclarationAst,
  depth: number,
): void {
  const model = ModelDeclarationAst.cast(declaration.syntax);
  if (model) {
    emitBlock(writer, depth, blockHeader('model', model.name()), () => {
      emitFieldRows(writer, Array.from(model.fields()), depth + 1);
      for (const attribute of model.attributes()) emitModelAttribute(writer, attribute, depth + 1);
    });
    return;
  }

  const composite = CompositeTypeDeclarationAst.cast(declaration.syntax);
  if (composite) {
    emitBlock(writer, depth, blockHeader('type', composite.name()), () => {
      emitFieldRows(writer, Array.from(composite.fields()), depth + 1);
      for (const attribute of composite.attributes())
        emitModelAttribute(writer, attribute, depth + 1);
    });
    return;
  }

  const enumDecl = EnumDeclarationAst.cast(declaration.syntax);
  if (enumDecl) {
    emitBlock(writer, depth, blockHeader('enum', enumDecl.name()), () => {
      emitEnumValueRows(writer, Array.from(enumDecl.values()), depth + 1);
      for (const attribute of enumDecl.attributes())
        emitModelAttribute(writer, attribute, depth + 1);
    });
    return;
  }

  const namespace = NamespaceDeclarationAst.cast(declaration.syntax);
  if (namespace) {
    emitBlock(writer, depth, blockHeader('namespace', namespace.name()), () => {
      for (const member of namespace.declarations()) emitDeclaration(writer, member, depth + 1);
    });
    return;
  }

  const typesBlock = TypesBlockAst.cast(declaration.syntax);
  if (typesBlock) {
    emitBlock(writer, depth, 'types {', () => {
      for (const named of typesBlock.declarations()) emitNamedType(writer, named, depth + 1);
    });
    return;
  }

  const generic = GenericBlockDeclarationAst.cast(declaration.syntax);
  if (generic) {
    emitBlock(writer, depth, blockHeader(genericKeyword(generic), generic.name()), () => {
      for (const entry of generic.entries()) emitKeyValue(writer, entry, depth + 1);
    });
  }
}

function emitBlock(writer: LineWriter, depth: number, header: string, emitBody: () => void): void {
  writer.push(depth, header);
  emitBody();
  writer.push(depth, '}');
}

function blockHeader(keyword: string, name: IdentifierAst | undefined): string {
  const named = identifierText(name);
  return named ? `${keyword} ${named} {` : `${keyword} {`;
}

function genericKeyword(generic: GenericBlockDeclarationAst): string {
  return generic.keyword()?.text ?? '';
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
}

function emitFieldRows(writer: LineWriter, fields: FieldDeclarationAst[], depth: number): void {
  const rows = fields.map<AlignmentRow>((field) => ({
    name: identifierText(field.name()),
    type: emitTypeAnnotation(field.typeAnnotation()),
    attributes: Array.from(field.attributes(), emitFieldAttribute).join(' '),
  }));
  emitAlignedRows(writer, rows, depth);
}

function emitEnumValueRows(
  writer: LineWriter,
  values: EnumValueDeclarationAst[],
  depth: number,
): void {
  const rows = values.map<AlignmentRow>((value) => ({
    name: identifierText(value.name()),
    type: '',
    attributes: Array.from(value.attributes(), emitFieldAttribute).join(' '),
  }));
  emitAlignedRows(writer, rows, depth);
}

function emitAlignedRows(writer: LineWriter, rows: readonly AlignmentRow[], depth: number): void {
  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length));
  const typeColumnEnd = Math.max(
    0,
    ...rows.map((row) => (row.type.length > 0 ? nameWidth + 1 + row.type.length : row.name.length)),
  );
  for (const row of rows) {
    writer.push(depth, renderAlignedRow(row, nameWidth, typeColumnEnd));
  }
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

function emitNamedType(writer: LineWriter, named: NamedTypeDeclarationAst, depth: number): void {
  const parts = [identifierText(named.name()), '=', emitTypeAnnotation(named.typeAnnotation())];
  for (const attribute of named.attributes()) parts.push(emitFieldAttribute(attribute));
  writer.push(depth, joinTokens(parts));
}

function emitKeyValue(writer: LineWriter, entry: KeyValuePairAst, depth: number): void {
  writer.push(depth, joinTokens([identifierText(entry.key()), '=', emitExpression(entry.value())]));
}

function emitTypeAnnotation(annotation: TypeAnnotationAst | undefined): string {
  if (!annotation) return '';
  let base = '';
  const constructorCall = annotation.constructorCall();
  if (constructorCall) {
    base = emitFunctionCall(constructorCall);
  } else {
    const space = identifierText(annotation.spaceName());
    const namespace = identifierText(annotation.namespaceName());
    const name = identifierText(annotation.name());
    const prefix = space ? `${space}:` : namespace ? `${namespace}.` : '';
    base = `${prefix}${name}`;
  }
  if (annotation.isList()) base += '[]';
  if (annotation.isOptional()) base += '?';
  return base;
}

function emitFieldAttribute(attribute: FieldAttributeAst): string {
  const namespace = identifierText(attribute.namespaceName());
  const name = identifierText(attribute.name());
  const qualified = namespace ? `${namespace}.${name}` : name;
  return `@${qualified}${emitArgList(attribute)}`;
}

function emitModelAttribute(writer: LineWriter, attribute: ModelAttributeAst, depth: number): void {
  writer.push(depth, `@@${identifierText(attribute.name())}${emitArgList(attribute)}`);
}

function emitArgList(attribute: FieldAttributeAst | ModelAttributeAst): string {
  const argList = attribute.argList();
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
  return `${identifierText(call.name())}(${args})`;
}

function identifierText(identifier: IdentifierAst | undefined): string {
  return identifier?.token()?.text ?? '';
}

function joinTokens(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(' ');
}
