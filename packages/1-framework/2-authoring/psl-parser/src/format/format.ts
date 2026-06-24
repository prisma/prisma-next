import { parse } from '../parse';
import { DocumentAst } from '../syntax/ast/declarations';
import { createSyntaxTree } from '../syntax/red';
import { canonicalizeRelationKeywords } from './canonicalize-relation';
import { emitDocument } from './emit';
import { PslFormatError } from './error';
import { type FormatOptions, resolveFormatOptions } from './options';

export function format(source: string, options?: FormatOptions): string {
  const resolved = resolveFormatOptions(options);
  const { document, diagnostics } = parse(source);
  if (diagnostics.length > 0) {
    throw new PslFormatError(diagnostics);
  }
  const canonical = canonicalizeRelationKeywords(document.syntax.green);
  const canonicalDocument = new DocumentAst(createSyntaxTree(canonical));
  return emitDocument(canonicalDocument, resolved.indentUnit, resolved.newline);
}
