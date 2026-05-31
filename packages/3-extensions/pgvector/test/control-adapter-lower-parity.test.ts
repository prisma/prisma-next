import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { buildDomainPlaneFromFlat } from '@prisma-next/contract/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import pgvectorControl from '../src/exports/control';
import pgvectorRuntime from '../src/exports/runtime';
import {
  createComposedPostgresAdapter,
  createComposedPostgresControlAdapter,
} from './helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:test-profile',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: 'sha256:test-core',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
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

// Compose a stack with pgvector on both planes so the runtime and control
// adapters' codec lookups both contain `pg/vector@1`. The parity assertion
// requires both sides to see the same codec set.
const runtimeAdapter = createComposedPostgresAdapter({ extensionPacks: [pgvectorRuntime] });
const controlAdapter = createComposedPostgresControlAdapter({ extensionPacks: [pgvectorControl] });

function expectParity(ast: AnyQueryAst): void {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
}

describe('PostgresControlAdapter.lower / PostgresAdapterImpl.lower parity', () => {
  it('matches on vector ParamRef casts', () => {
    const vectorAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vector'),
          ParamRef.of([1, 2, 3], { name: 'vec', codec: { codecId: 'pg/vector@1' } }),
        ),
      );
    expectParity(vectorAst);

    expect(runtimeAdapter.lower(vectorAst, { contract }).sql).toContain('::vector');
  });
});
