import { parse } from '../parse';
import { emitDocument } from './emit';
import { PslFormatError } from './error';
import { type FormatOptions, resolveFormatOptions } from './options';

/**
 * Pretty-prints PSL source into a canonical, deterministic form. Parses the
 * source via the shared CST parser; if the parse produces any diagnostics it
 * refuses with a {@link PslFormatError} rather than emitting best-effort output.
 * Otherwise it walks the document's declarations in source order and re-emits
 * structurally-canonical PSL using the resolved indent and newline.
 */
export function format(source: string, options?: FormatOptions): string {
  const resolved = resolveFormatOptions(options);
  const { document, diagnostics } = parse(source);
  if (diagnostics.length > 0) {
    throw new PslFormatError(diagnostics);
  }
  return emitDocument(document, resolved.indentUnit, resolved.newline);
}
