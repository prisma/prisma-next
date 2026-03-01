import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@prisma-next/config/config-types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { interpretPslDocumentToSqlContractIR } from './interpreter';

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target?: TargetPackRef<'sql', 'postgres'>;
  /**
   * Milestone-local namespace availability hook.
   *
   * This currently models composed extension packs by id only (for example `["pgvector"]`),
   * and is sufficient for namespace presence checks in the PSL interpreter.
   *
   * Future milestones can evolve this to richer composed pack metadata/manifests when
   * attribute-level schema/argument validation needs to move beyond namespace existence.
   */
  readonly composedExtensionPacks?: readonly string[];
}

export function prismaContract(
  schemaPath: string,
  options?: PrismaContractOptions,
): ContractConfig {
  return {
    source: async () => {
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

      return interpretPslDocumentToSqlContractIR({
        document,
        ...ifDefined('target', options?.target),
        ...ifDefined('composedExtensionPacks', options?.composedExtensionPacks),
      });
    },
    ...ifDefined('output', options?.output),
  };
}
