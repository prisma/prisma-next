import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@prisma-next/config/config-types';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
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

        // dispatch-4: thin bridge to keep src/ compiling. The real provider
        // swap (combined parse + symbol-table diagnostic seeding, mirroring the
        // SQL provider's `seedDiagnostics`) lands in dispatch 4; for now this
        // builds the symbol table and threads the new interpreter input shape
        // without surfacing parse/symbol-table diagnostics.
        const { document, sourceFile } = parse(schema);
        const { table: symbolTable } = buildSymbolTable({
          document,
          sourceFile,
          scalarTypes: [...context.scalarTypeDescriptors.keys()],
        });

        const interpreted = interpretPslDocumentToMongoContract({
          symbolTable,
          sourceFile,
          sourceId: schemaPath,
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
