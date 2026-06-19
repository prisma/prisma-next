import { parse } from '@prisma-next/psl-parser/syntax';
import { type LspDiagnostic, mapParseDiagnostics } from './diagnostic-mapping';
import type { SchemaInputSet } from './schema-inputs';

/**
 * `null` (not a configured input) is distinct from `[]` (an input that parsed
 * clean): the caller treats both as "publish no diagnostics", but only the
 * latter is a document we own and keep diagnosing.
 */
export function computeDocumentDiagnostics(
  uri: string,
  text: string,
  inputs: SchemaInputSet,
): readonly LspDiagnostic[] | null {
  if (!inputs.includes(uri)) {
    return null;
  }
  return mapParseDiagnostics(parse(text).diagnostics);
}
