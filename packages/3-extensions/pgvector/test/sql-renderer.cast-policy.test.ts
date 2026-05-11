import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';

const emptyLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

describe('pgvector cast policy', () => {
  it('emits $1::vector when pgvector is installed via stack.extensionPacks', async () => {
    // Smoke test for the M2 wiring fix: `pgvectorRuntimeDescriptor` exposes its codecs via `types.codecTypes.codecDescriptors`, so the adapter's runtime-plane lookup picks up `pg/vector@1` and the renderer emits the cast. Without the wiring fix this regresses to `$1`.
    const pgvectorRuntime = (await import('@prisma-next/extension-pgvector/runtime')).default;

    const adapter = createComposedPostgresAdapter({ extensionPacks: [pgvectorRuntime] });

    const vectorContract = validateContract<PostgresContract>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: 'sha256:vector-cast-policy',
        roots: {},
        capabilities: {},
        extensionPacks: {},
        meta: {},
        storage: {
          storageHash: 'sha256:vector-cast-policy',
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                vec: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
      },
      emptyLookup,
    );

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vec'),
          ParamRef.of([1, 2, 3], { name: 'vec', codecId: 'pg/vector@1' }),
        ),
      );
    const lowered = adapter.lower(ast, { contract: vectorContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."vec" = $1::vector',
    );
  });
});
