import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@prisma-next/config/config-types';
import { applySpecifierDefaultControlPolicy } from '@prisma-next/contract/apply-specifier-default-control-policy';
import type { ControlPolicy } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { Namespace } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlNamespaceTablesInput } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { basename, extname } from 'pathe';
import { interpretPslDocumentToSqlContract } from './interpreter';
import type { ColumnDescriptor } from './psl-column-resolution';

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly createNamespace?: (input: SqlNamespaceTablesInput) => Namespace;
  readonly defaultControlPolicy?: ControlPolicy;
}

/**
 * Derives the emit output path from the schema input path so artefacts land
 * colocated with the source (e.g. `src/contract/schema.prisma` →
 * `src/contract/contract.json`). The provider owns this because it is the
 * only layer that knows the input path; the upstream `normalizeContractConfig`
 * default is a last-resort fallback for providers that don't carry one.
 */
function defaultOutputFromSchemaPath(schemaPath: string): string {
  const ext = extname(schemaPath);
  if (ext.length === 0) return `${schemaPath}.json`;
  const base = schemaPath.slice(0, -ext.length);
  // PSL schemas commonly use `schema.prisma`; the emitted JSON is called
  // `contract.json` to mirror the rest of the toolchain, not `schema.json`.
  // Match only the exact basename `schema` so files like `my-schema.prisma`
  // are not silently rewritten to `my-contract.json`.
  if (basename(base) === 'schema') {
    return `${base.slice(0, -'schema'.length)}contract.json`;
  }
  return `${base}.json`;
}

function buildColumnDescriptorMap(
  scalarTypeDescriptors: ReadonlyMap<string, string>,
  codecLookup: CodecLookup,
): ReadonlyMap<string, ColumnDescriptor> {
  const result = new Map<string, ColumnDescriptor>();
  for (const [typeName, codecId] of scalarTypeDescriptors) {
    const nativeType = codecLookup.targetTypesFor(codecId)?.[0];
    if (nativeType === undefined) continue;
    result.set(typeName, { codecId, nativeType });
  }
  return result;
}

export function prismaContract(schemaPath: string, options: PrismaContractOptions): ContractConfig {
  return {
    source: {
      inputs: [schemaPath],
      load: async (context) => {
        const [absoluteSchemaPath] = context.resolvedInputs;
        if (absoluteSchemaPath === undefined) {
          throw new Error(
            'prismaContract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
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

        const document = parsePslDocument({
          schema,
          sourceId: schemaPath,
          pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
          codecLookup: context.codecLookup,
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
          composedExtensionContracts: context.composedExtensionContracts,
          ...ifDefined(
            'composedExtensionPackRefs',
            options.composedExtensionPackRefs?.length
              ? options.composedExtensionPackRefs
              : undefined,
          ),
          controlMutationDefaults: context.controlMutationDefaults,
          ...ifDefined('createNamespace', options.createNamespace),
        });
        if (!interpreted.ok) {
          return interpreted;
        }

        return ok(
          applySpecifierDefaultControlPolicy(interpreted.value, options.defaultControlPolicy),
        );
      },
    },
    output: options.output ?? defaultOutputFromSchemaPath(schemaPath),
  };
}
