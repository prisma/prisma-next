/**
 * Control-plane hooks and database dependencies for pgvector.
 *
 * `vectorControlPlaneHooks` contributes two callbacks the SQL control plane
 * reads when planning DDL: how to expand a `vector` native type with a
 * dimension into the dialect-rendered form (`vector(1536)`), and how to
 * resolve the column's identity value for migration scaffolding.
 *
 * `pgvectorDatabaseDependencies` declares the `CREATE EXTENSION IF NOT
 * EXISTS vector` operation the migration planner emits before any vector
 * column DDL.
 */

import type {
  CodecControlHooks,
  ComponentDatabaseDependencies,
} from '@prisma-next/family-sql/control';

function buildVectorIdentityValue(typeParams: Record<string, unknown> | undefined): string | null {
  const length = typeParams?.['length'];
  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    return null;
  }

  const zeroVector = `[${new Array(length).fill('0').join(',')}]`;
  return `'${zeroVector}'::vector`;
}

export const vectorControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    const length = typeParams?.['length'];
    if (typeof length === 'number' && Number.isInteger(length) && length > 0) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  },
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};

export const pgvectorDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.vector',
      label: 'Enable vector extension',
      install: [
        {
          id: 'extension.vector',
          label: 'Enable extension "vector"',
          summary: 'Ensures the vector extension is available for pgvector operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "vector" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
          execute: [
            {
              description: 'create extension "vector"',
              sql: 'CREATE EXTENSION IF NOT EXISTS vector',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "vector" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
        },
      ],
    },
  ],
};
