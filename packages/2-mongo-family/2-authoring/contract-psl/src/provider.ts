import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ParseDiagnostic, SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse, resolve } from '@prisma-next/psl-parser/syntax';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
}

/**
 * Lowers a `psl-parser` syntactic/semantic diagnostic into the config-layer
 * `ContractSourceDiagnostic` the provider's `notOk` channel carries. The
 * resolver reports `{ line, character }` positions; the `ContractSourceDiagnostic`
 * span also carries an `offset`, recovered through the same `SourceFile`.
 */
function toContractSourceDiagnostic(
  diagnostic: ParseDiagnostic,
  sourceId: string,
  sourceFile: SourceFile,
): ContractSourceDiagnostic {
  const { start, end } = diagnostic.range;
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: {
      start: {
        offset: sourceFile.offsetAt(start),
        line: start.line,
        column: start.character,
      },
      end: {
        offset: sourceFile.offsetAt(end),
        line: end.line,
        column: end.character,
      },
    },
  };
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  return {
    source: {
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

        const { document, diagnostics: parseDiagnostics, sourceFile } = parse(schema);
        const resolved = resolve(document, { codecLookup: context.codecLookup });

        const syntacticAndSemantic = [...parseDiagnostics, ...resolved.diagnostics];
        if (syntacticAndSemantic.length > 0) {
          return notOk({
            summary: `Failed to parse Prisma schema at "${schemaPath}"`,
            diagnostics: syntacticAndSemantic.map((diagnostic) =>
              toContractSourceDiagnostic(diagnostic, schemaPath, sourceFile),
            ),
          });
        }

        const interpreted = interpretPslDocumentToMongoContract({
          document: resolved,
          sourceId: schemaPath,
          sourceFile,
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
