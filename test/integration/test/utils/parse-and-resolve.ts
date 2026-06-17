import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ResolvedDocument, SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse, resolve } from '@prisma-next/psl-parser/syntax';
import { ifDefined } from '@prisma-next/utils/defined';

/**
 * The built-in scalar names a SQL target declares. `resolve` requires the
 * caller to supply its target's scalar set (no framework default); SQL-family
 * integration tests pass this set, matching the keys a real SQL target's
 * `scalarTypeDescriptors` contributes. Mongo-family callers pass their own
 * (e.g. one that includes `ObjectId`).
 */
const DEFAULT_SQL_SCALAR_TYPES: ReadonlySet<string> = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

export interface ParseAndResolveInput {
  readonly schema: string;
  readonly sourceId?: string;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  readonly codecLookup?: CodecLookup;
  readonly scalarTypes?: ReadonlySet<string>;
}

/**
 * Builds the interpreter's document input from PSL source the way the
 * `contract-psl` providers do: `parse` produces the CST + syntactic
 * diagnostics, `resolve` produces the `ResolvedDocument` + semantic
 * diagnostics, and the two diagnostic lists are merged onto the document the
 * interpreter reads. Returns the `{ document, sourceId, sourceFile }` triple
 * the interpreter inputs require.
 */
export function parseAndResolve(input: ParseAndResolveInput): {
  document: ResolvedDocument;
  sourceId: string;
  sourceFile: SourceFile;
} {
  const sourceId = input.sourceId ?? 'schema.prisma';
  const { document, diagnostics: parseDiagnostics, sourceFile } = parse(input.schema);
  const resolved = resolve(document, sourceFile, {
    scalarTypes: input.scalarTypes ?? DEFAULT_SQL_SCALAR_TYPES,
    ...ifDefined('pslBlockDescriptors', input.pslBlockDescriptors),
    ...ifDefined('codecLookup', input.codecLookup),
  });
  return {
    document: { ...resolved, diagnostics: [...parseDiagnostics, ...resolved.diagnostics] },
    sourceId,
    sourceFile,
  };
}
