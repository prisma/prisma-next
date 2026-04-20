import { readFile } from 'node:fs/promises';
import type {
  ContractConfig,
  ContractSourceContext,
  ContractSourceEnvironment,
} from '@prisma-next/config/config-types';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  return {
    source: {
      inputs: [schemaPath],
      load: async (context: ContractSourceContext, environment: ContractSourceEnvironment) => {
        const absoluteSchemaPath = resolve(environment.configDir, schemaPath);
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

        const interpreted = interpretPslDocumentToMongoContract({
          document,
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
