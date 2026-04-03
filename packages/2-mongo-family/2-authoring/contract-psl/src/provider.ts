import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceContext } from '@prisma-next/config/config-types';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { interpretPslDocumentToMongoContractIR } from './interpreter';
import { createMongoScalarTypeDescriptors } from './scalar-type-descriptors';

export interface MongoContractOptions {
  readonly output?: string;
  readonly scalarTypeDescriptors?: ReadonlyMap<string, string>;
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  return {
    source: async (_context: ContractSourceContext) => {
      const absoluteSchemaPath = resolve(schemaPath);
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

      const document = parsePslDocument({
        schema,
        sourceId: schemaPath,
      });

      const interpreted = interpretPslDocumentToMongoContractIR({
        document,
        scalarTypeDescriptors: options?.scalarTypeDescriptors ?? createMongoScalarTypeDescriptors(),
      });
      if (!interpreted.ok) {
        return interpreted;
      }

      return ok(interpreted.value);
    },
    ...ifDefined('output', options?.output),
  };
}
