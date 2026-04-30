import { parsePslDocument } from '@prisma-next/psl-parser';
import type { PslDocumentAst } from '@prisma-next/psl-types';
import { legacySqlIrToPrintDocument } from './legacy-print-pipeline';
import { createPostgresDefaultMapping } from './postgres-default-mapping';
import { createPostgresTypeMap, extractEnumInfo } from './postgres-type-map';
import { printPslFromAst } from './print-psl';
import { parseRawDefault } from './raw-default-parser';
import type { PslPrintableSqlSchemaIR } from './schema-validation';
import { validatePrintableSqlSchemaIR } from './schema-validation';
import { serializePrintDocument } from './serialize-print-document';
import type { PslPrinterOptions } from './types';

function postgresLegacyOptions(schema: PslPrintableSqlSchemaIR): PslPrinterOptions {
  const enumInfo = extractEnumInfo(schema.annotations);
  return {
    defaultMapping: createPostgresDefaultMapping(),
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    enumInfo,
    parseRawDefault,
  };
}

export function legacyInputToAst(
  schemaIR: PslPrintableSqlSchemaIR,
  options: PslPrinterOptions,
): PslDocumentAst {
  const doc = legacySqlIrToPrintDocument(schemaIR, options);
  const text = serializePrintDocument(doc);
  const parsed = parsePslDocument({ schema: text, sourceId: '<legacy-print>' });
  if (!parsed.ok) {
    const detail = parsed.diagnostics.map((d) => d.message).join('; ');
    throw new Error(`legacyInputToAst: parse failed (${detail})`);
  }
  const commentByModelName = new Map(doc.models.map((m) => [m.name, m.comment]));
  return {
    ...parsed.ast,
    headerComment: doc.headerComment,
    models: parsed.ast.models.map((m) => {
      const comment = commentByModelName.get(m.name);
      return comment !== undefined ? { ...m, comment } : m;
    }),
  };
}

/**
 * @deprecated Removed in M2. Postgres-specific path that validates schema IR and prints via AST.
 */
export function printPslLegacy(
  schemaIR: unknown,
  optionOverride?: Partial<PslPrinterOptions>,
): string {
  const schema = validatePrintableSqlSchemaIR(schemaIR);
  const base = postgresLegacyOptions(schema);
  const options: PslPrinterOptions = { ...optionOverride, ...base };
  return printPslFromAst(legacyInputToAst(schema, options));
}

export function legacyPostgresPrinterOptions(schema: PslPrintableSqlSchemaIR): PslPrinterOptions {
  return postgresLegacyOptions(schema);
}
