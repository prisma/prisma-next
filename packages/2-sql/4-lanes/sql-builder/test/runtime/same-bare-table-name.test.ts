import type { ProjectionItem, SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import type { Contract } from '../fixtures/generated/contract';

function column(codecId: string) {
  return { codecId, nativeType: codecId, nullable: false } as const;
}

function table(columns: Record<string, ReturnType<typeof column>>) {
  return {
    columns,
    foreignKeys: [],
    indexes: [],
    primaryKey: { columns: ['id'] },
    uniques: [],
  };
}

// Both namespaces declare a table with the same bare name `users` but with
// differing columns/codecs, so column/codec resolution must discriminate by
// the namespace coordinate the proxy carries.
const twoNamespaceContract = {
  capabilities: {},
  target: 'postgres',
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        tables: { users: table({ id: column('pg/int4@1'), email_addr: column('pg/text@1') }) },
      },
      auth: {
        id: 'auth',
        tables: { users: table({ id: column('pg/int4@1'), token_col: column('pg/varchar@1') }) },
      },
    },
  },
};

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  types: {},
  applyMutationDefaults: () => [],
};

type SelectHandle = { select(column: string): { build(): { ast: SelectAst } } };
type TwoNamespaceDb = {
  public: { users: SelectHandle };
  auth: { users: SelectHandle };
};

function db() {
  return sql({
    context: {
      ...stubBase,
      contract: twoNamespaceContract,
    } as unknown as ExecutionContext<Contract>,
    rawCodecInferer: { inferCodec: () => 'pg/text@1' },
  }) as unknown as TwoNamespaceDb;
}

function projectionCodecId(ast: SelectAst): string | undefined {
  const projection = (ast as unknown as { projection: ProjectionItem[] }).projection[0];
  return (projection as unknown as { codec?: { codecId: string } }).codec?.codecId;
}

describe('same bare table name across namespaces', () => {
  it('resolves the column codec within the proxy namespace, discriminating per namespace', () => {
    const publicAst = db().public.users.select('email_addr').build().ast;
    expect(projectionCodecId(publicAst)).toBe('pg/text@1');
    expect((publicAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe(
      'public',
    );

    const authAst = db().auth.users.select('token_col').build().ast;
    expect(projectionCodecId(authAst)).toBe('pg/varchar@1');
    expect((authAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe('auth');
  });
});
