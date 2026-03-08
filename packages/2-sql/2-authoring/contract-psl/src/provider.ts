import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceContext } from '@prisma-next/config/config-types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { createBuiltinDefaultFunctionRegistry } from './default-function-registry';
import { interpretPslDocumentToSqlContractIR } from './interpreter';

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target?: TargetPackRef<'sql', 'postgres'>;
}

export function prismaContract(
  schemaPath: string,
  options?: PrismaContractOptions,
): ContractConfig {
  return {
    source: async (context: ContractSourceContext) => {
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

      const interpreted = interpretPslDocumentToSqlContractIR({
        document,
        ...ifDefined('target', options?.target),
        composedExtensionPacks: context.composedExtensionPacks,
        defaultFunctionRegistry: createBuiltinDefaultFunctionRegistry(),
      });
      if (!interpreted.ok) {
        return interpreted;
      }

      return ok(interpreted.value);
    },
    ...ifDefined('output', options?.output),
  };
}
