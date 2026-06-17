import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ParseDiagnostic, SourceFile } from '@prisma-next/psl-parser/syntax';
import { DEFAULT_SCALAR_TYPES, parse, resolve } from '@prisma-next/psl-parser/syntax';
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
        const resolved = resolve(document, sourceFile, {
          codecLookup: context.codecLookup,
          scalarTypes: new Set([...DEFAULT_SCALAR_TYPES, ...context.scalarTypeDescriptors.keys()]),
        });

        // Mongo's own scalars (`ObjectId`, …) now resolve as `scalar` targets
        // because they are in the per-target `scalarTypes` set above, so a valid
        // scalar no longer produces a spurious `PSL_UNRESOLVED_TYPE_REFERENCE`.
        // A *genuinely* unknown type still resolves to `unresolved` and would
        // surface that new resolver code, which the interpreter never raised: its
        // own `PSL_UNSUPPORTED_FIELD_TYPE` (a `scalarTypeDescriptors` miss) is the
        // authoritative unknown-type signal. The filter keeps byte-identity by
        // dropping the resolver code for those genuine unknowns; all other resolve
        // diagnostics (name-collision, extension-block) and parse diagnostics pass
        // through.
        const semanticDiagnostics = resolved.diagnostics.filter(
          (diagnostic) => diagnostic.code !== 'PSL_UNRESOLVED_TYPE_REFERENCE',
        );

        const syntacticAndSemantic = [...parseDiagnostics, ...semanticDiagnostics];
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
