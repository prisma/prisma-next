import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import type { ParseDiagnostic, SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { rangeToPslSpan } from './cst-read';
import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
}

/**
 * Map a parser/symbol-table `ParseDiagnostic` (`{ code, message, range }`) to
 * the `ContractSourceDiagnostic` the provider surfaces, stamping the provider's
 * `sourceId` and deriving the span from the diagnostic `range`. Mirrors the SQL
 * provider's `mapParseDiagnostics`, now that `parse` + `buildSymbolTable` are
 * the source of truth.
 */
function mapParseDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
  sourceFile: SourceFile,
  sourceId: string,
): ContractSourceDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  return {
    source: {
      sourceFormat: 'psl',
      inputs: [schemaPath],
      load: async (context) => {
        const [absoluteSchemaPath] = context.resolvedInputs;
        if (absoluteSchemaPath === undefined) {
          throw new Error(
            'mongoContract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
          );
        }
        let schema: string;
        try {
          schema = await readFile(absoluteSchemaPath, 'utf-8');
        } catch (error) {
          const message = String(error);
          return notOk({
            summary: `Failed to read Prisma schema at "${schemaPath}"`,
            diagnostics: [
              {
                code: 'PSL_SCHEMA_READ_FAILED',
                message,
                sourceId: schemaPath,
              },
            ],
            meta: { schemaPath, absoluteSchemaPath, cause: message },
          });
        }

        // `parse` yields the CST + syntactic diagnostics; `buildSymbolTable`
        // adds its own duplicate-name diagnostics (two separate lists per the
        // project decision).
        const { document, sourceFile, diagnostics: parseDiagnostics } = parse(schema);
        const { table: symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
          document,
          sourceFile,
          scalarTypes: [...context.scalarTypeDescriptors.keys()],
        });

        // Seed the combined parse + symbol-table diagnostics into the
        // interpreter (rather than short-circuiting): it walks the recovered
        // document, appends its own diagnostics, and its post-walk dedupe gate
        // emits the deduped parse + symbol-table + interpreter union in one run
        // — matching the legacy combined-set parser behaviour, consistent with
        // the SQL provider.
        const seedDiagnostics = [
          ...mapParseDiagnostics(parseDiagnostics, sourceFile, schemaPath),
          ...mapParseDiagnostics(symbolTableDiagnostics, sourceFile, schemaPath),
        ];

        const interpreted = interpretPslDocumentToMongoContract({
          symbolTable,
          sourceFile,
          sourceId: schemaPath,
          seedDiagnostics,
          scalarTypeDescriptors: context.scalarTypeDescriptors,
          codecLookup: context.codecLookup,
        });
        if (!interpreted.ok) {
          return interpreted;
        }

        return ok(interpreted.value);
      },
    },
    ...ifDefined('output', options?.output),
  };
}
