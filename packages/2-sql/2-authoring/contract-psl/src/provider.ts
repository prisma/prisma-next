import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceContext } from '@prisma-next/config/config-types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { interpretPslDocumentToSqlContract } from './interpreter';
import type { ColumnDescriptor } from './psl-column-resolution';

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', 'postgres'>;
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', 'postgres'>[];
}

function buildColumnDescriptorMap(
  scalarTypeDescriptors: ReadonlyMap<string, string>,
  codecLookup: CodecLookup,
): ReadonlyMap<string, ColumnDescriptor> {
  const result = new Map<string, ColumnDescriptor>();
  for (const [typeName, codecId] of scalarTypeDescriptors) {
    const codec = codecLookup.get(codecId);
    if (!codec) continue;
    const nativeType = codec.targetTypes[0];
    if (nativeType === undefined) continue;
    result.set(typeName, { codecId, nativeType });
  }
  return result;
}

export function prismaContract(schemaPath: string, options: PrismaContractOptions): ContractConfig {
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

      const scalarTypeDescriptors = buildColumnDescriptorMap(
        context.scalarTypeDescriptors,
        context.codecLookup,
      );

      const interpreted = interpretPslDocumentToSqlContract({
        document,
        target: options.target,
        authoringContributions: context.authoringContributions,
        scalarTypeDescriptors,
        ...ifDefined(
          'composedExtensionPacks',
          context.composedExtensionPacks.length > 0
            ? [...context.composedExtensionPacks]
            : undefined,
        ),
        ...ifDefined(
          'composedExtensionPackRefs',
          options.composedExtensionPackRefs?.length ? options.composedExtensionPackRefs : undefined,
        ),
        controlMutationDefaults: context.controlMutationDefaults,
      });
      if (!interpreted.ok) {
        return interpreted;
      }

      return ok(interpreted.value);
    },
    ...ifDefined('output', options.output),
  };
}
