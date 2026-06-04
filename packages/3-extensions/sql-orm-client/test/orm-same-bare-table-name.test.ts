import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, type MockRuntime } from './helpers';

function model(table: string, fieldColumns: Record<string, string>) {
  const fields: Record<string, { type: { kind: string; codecId: string } }> = {};
  const storageFields: Record<string, { column: string }> = {};
  for (const [field, column] of Object.entries(fieldColumns)) {
    fields[field] = { type: { kind: 'scalar', codecId: 'pg/text@1' } };
    storageFields[field] = { column };
  }
  return { fields, relations: {}, storage: { table, fields: storageFields } };
}

function storageTable(columnCodecs: Record<string, string>) {
  const cols: Record<string, { codecId: string; nativeType: string; nullable: boolean }> = {};
  for (const [column, codecId] of Object.entries(columnCodecs)) {
    cols[column] = { codecId, nativeType: codecId, nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// `User` is declared in both namespaces, both backed by a table with the SAME
// bare name `users` but DIFFERING columns/codecs, so column/codec resolution
// must discriminate by the namespace coordinate.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: { returning: { enabled: true } },
  domain: {
    namespaces: {
      public: { models: { User: model('users', { id: 'id', email: 'email_addr' }) } },
      auth: { models: { User: model('users', { id: 'id', token: 'token_col' }) } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        tables: { users: storageTable({ id: 'pg/int4@1', email_addr: 'pg/text@1' }) },
      },
      auth: {
        id: 'auth',
        tables: { users: storageTable({ id: 'pg/int4@1', token_col: 'pg/varchar@1' }) },
      },
    },
  },
});

type CrudCollection = {
  all(): { toArray(): Promise<Record<string, unknown>[]> };
  create(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  where(filter: Record<string, unknown>): {
    deleteAll(): { toArray(): Promise<Record<string, unknown>[]> };
  };
};
type TwoNamespaceOrm = { public: { User: CrudCollection }; auth: { User: CrudCollection } };

function setup(): { db: TwoNamespaceOrm; runtime: MockRuntime } {
  const runtime = createMockRuntime();
  const db = blindCast<TwoNamespaceOrm, 'loose runtime view of the namespaced orm client'>(
    orm({
      runtime,
      context: blindCast<ExecutionContext<Contract<SqlStorage>>, 'stub execution context'>({
        contract: twoNamespaceContract,
        applyMutationDefaults: () => [],
        codecDescriptors: { descriptorFor: () => ({ traits: ['equality'] }) },
      }),
    }),
  );
  return { db, runtime };
}

function lastPlanAst(runtime: MockRuntime): SelectAst {
  const plan = runtime.executions[runtime.executions.length - 1]?.plan;
  return blindCast<SelectAst, 'select plan ast'>((plan as { ast: unknown }).ast);
}

function projectionItems(ast: SelectAst): ProjectionItem[] {
  return blindCast<ProjectionItem[], 'select projection'>(
    (ast as unknown as { projection: ProjectionItem[] }).projection,
  );
}

function projectedColumns(ast: SelectAst): string[] {
  return projectionItems(ast).map((item) => {
    const expr = blindCast<ColumnRef, 'projection column ref'>(
      (item as unknown as { expr: unknown }).expr,
    );
    return (expr as unknown as { column: string }).column;
  });
}

function codecByColumn(ast: SelectAst): Record<string, string | undefined> {
  return codecByColumnOfProjection(projectionItems(ast));
}

function codecByColumnOfProjection(
  projection: readonly ProjectionItem[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const item of projection) {
    const column = (
      blindCast<ColumnRef, 'projection column ref'>(
        (item as unknown as { expr: unknown }).expr,
      ) as unknown as { column: string }
    ).column;
    result[column] = (item as unknown as { codec?: { codecId: string } }).codec?.codecId;
  }
  return result;
}

type WriteAst = {
  table: TableSource;
  returning?: readonly ProjectionItem[];
};

function lastWriteAst(runtime: MockRuntime): WriteAst {
  const plan = runtime.executions[runtime.executions.length - 1]?.plan;
  return blindCast<WriteAst, 'write plan ast'>((plan as { ast: unknown }).ast);
}

function returningCodecByColumn(ast: WriteAst): Record<string, string | undefined> {
  return codecByColumnOfProjection(ast.returning ?? []);
}

describe('orm same bare table name across namespaces', () => {
  it('projects the per-namespace columns, discriminating by namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicRows = await db.public.User.all().toArray();
    expect(publicRows).toEqual([{ id: 1, email: 'a@example.com' }]);
    const publicAst = lastPlanAst(runtime);
    expect(projectedColumns(publicAst).sort()).toEqual(['email_addr', 'id']);
    expect(codecByColumn(publicAst)).toEqual({ id: 'pg/int4@1', email_addr: 'pg/text@1' });
    expect((publicAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe(
      'public',
    );

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authRows = await db.auth.User.all().toArray();
    expect(authRows).toEqual([{ id: 2, token: 'tok' }]);
    const authAst = lastPlanAst(runtime);
    expect(projectedColumns(authAst).sort()).toEqual(['id', 'token_col']);
    expect(codecByColumn(authAst)).toEqual({ id: 'pg/int4@1', token_col: 'pg/varchar@1' });
    expect((authAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe('auth');
  });

  it('resolves per-namespace returning columns/codecs on create, discriminating by namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicCreated = await db.public.User.create({ id: 1, email: 'a@example.com' });
    expect(publicCreated).toEqual({ id: 1, email: 'a@example.com' });
    const publicCreateAst = lastWriteAst(runtime);
    expect(publicCreateAst.table.namespaceId).toBe('public');
    expect(returningCodecByColumn(publicCreateAst)).toEqual({
      id: 'pg/int4@1',
      email_addr: 'pg/text@1',
    });

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authCreated = await db.auth.User.create({ id: 2, token: 'tok' });
    expect(authCreated).toEqual({ id: 2, token: 'tok' });
    const authCreateAst = lastWriteAst(runtime);
    expect(authCreateAst.table.namespaceId).toBe('auth');
    expect(returningCodecByColumn(authCreateAst)).toEqual({
      id: 'pg/int4@1',
      token_col: 'pg/varchar@1',
    });
  });

  it('resolves per-namespace returning columns/codecs on delete, discriminating by namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicDeleted = await db.public.User.where({ email: 'a@example.com' })
      .deleteAll()
      .toArray();
    expect(publicDeleted).toEqual([{ id: 1, email: 'a@example.com' }]);
    const publicDeleteAst = lastWriteAst(runtime);
    expect(publicDeleteAst.table.namespaceId).toBe('public');
    expect(returningCodecByColumn(publicDeleteAst)).toEqual({
      id: 'pg/int4@1',
      email_addr: 'pg/text@1',
    });

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authDeleted = await db.auth.User.where({ token: 'tok' }).deleteAll().toArray();
    expect(authDeleted).toEqual([{ id: 2, token: 'tok' }]);
    const authDeleteAst = lastWriteAst(runtime);
    expect(authDeleteAst.table.namespaceId).toBe('auth');
    expect(returningCodecByColumn(authDeleteAst)).toEqual({
      id: 'pg/int4@1',
      token_col: 'pg/varchar@1',
    });
  });
});
