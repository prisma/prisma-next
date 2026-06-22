import { parse } from '../parse';
import { emitDocument } from './emit';
import { PslFormatError } from './error';
import { type FormatOptions, resolveFormatOptions } from './options';

export function format(source: string, options?: FormatOptions): string {
  const resolved = resolveFormatOptions(options);
  const { document, diagnostics } = parse(source);
  if (diagnostics.length > 0) {
    throw new PslFormatError(diagnostics);
  }
  return emitDocument(document, resolved.indentUnit, resolved.newline);
}
