import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { buildDomainPlaneFromFlat } from '@prisma-next/contract/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
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

describe('pgvector cast policy', () => {
  it('emits $1::vector when pgvector is installed via stack.extensionPacks', async () => {
    // Regression: `pgvectorRuntimeDescriptor` must expose its codecs via `types.codecTypes.codecDescriptors` so the adapter's runtime-plane codec lookup resolves `pg/vector@1` and the renderer emits the `::vector` cast. If the descriptor stops surfacing those codecs, the rendered SQL silently regresses to bare `$1`.
    const pgvectorRuntime = (await import('../src/exports/runtime')).default;

    const adapter = createComposedPostgresAdapter({ extensionPacks: [pgvectorRuntime] });

    const vectorContract = new SqlContractSerializer().deserializeContract({
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:vector-cast-policy',
      roots: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
      storage: {
        storageHash: 'sha256:vector-cast-policy',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
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
        },
      },
      domain: buildDomainPlaneFromFlat({ models: {} }),
    }) as PostgresContract;

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vec'),
          ParamRef.of([1, 2, 3], { name: 'vec', codec: { codecId: 'pg/vector@1' } }),
        ),
      );
    const lowered = adapter.lower(ast, { contract: vectorContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."vec" = $1::vector',
    );
  });
});
