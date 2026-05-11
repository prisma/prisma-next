import type { Contract } from '@prisma-next/contract/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
  parseAnyQueryAst,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { dataTransformAst } from '@prisma-next/target-postgres/data-transform';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONTRACT_HASH = 'sha256:contract-abc';

const lowerMock = vi.fn();

function makeAdapter(): SqlControlAdapter<'postgres'> {
  return { lower: lowerMock } as unknown as SqlControlAdapter<'postgres'>;
}

function makeContract(storageHash: string = CONTRACT_HASH): Contract<SqlStorage> {
  return {
    storage: { storageHash, tables: {}, extensions: {}, schemas: [], types: {} },
    profile: { profileHash: 'sha256:profile', lanes: {} },
  } as unknown as Contract<SqlStorage>;
}

function makeRegistry(): CodecDescriptorRegistry {
  return {
    descriptorFor() {
      return undefined;
    },
    codecRefForColumn() {
      return undefined;
    },
    *values() {},
    byTargetType() {
      return [];
    },
  };
}

describe('dataTransformAst factory', () => {
  beforeEach(() => {
    lowerMock.mockReset();
  });

  it('embeds serialized AST in execute steps instead of pre-lowered SQL', () => {
    const ast = UpdateAst.table(TableSource.named('user')).withSet({
      name: ParamRef.of('Bob', { codec: { codecId: 'pg/text@1' } }),
    });

    const makePlan = (): SqlQueryPlan => ({
      ast,
      params: [] as unknown as SqlQueryPlan['params'],
      meta: {
        target: 'postgres',
        storageHash: CONTRACT_HASH,
        lane: 'sql',
      } as unknown as SqlQueryPlan['meta'],
    });

    const op = dataTransformAst(
      makeContract(),
      'backfill-names',
      { run: () => makePlan() },
      makeAdapter(),
    );

    expect(lowerMock).not.toHaveBeenCalled();
    expect(op.id).toBe('data_migration_ast.backfill-names');
    expect(op.operationClass).toBe('data');
    expect(op.execute).toHaveLength(1);

    const step = op.execute[0]!;
    expect(step.meta).toBeDefined();
    expect(step.meta!['ast']).toBeDefined();

    const parsedAst = parseAnyQueryAst(step.meta!['ast'], makeRegistry());
    expect(parsedAst).toBeInstanceOf(UpdateAst);
    const update = parsedAst as UpdateAst;
    expect((update.set['name'] as ParamRef).codec).toEqual({ codecId: 'pg/text@1' });
  });

  it('round-trips AST through JSON serialization', () => {
    const codec = { codecId: 'pg/vector@1', typeParams: { length: 1536 } };
    const ast = UpdateAst.table(TableSource.named('document')).withSet({
      embedding: ParamRef.of([1.0, 2.0], { codec }),
    });

    const makePlan = (): SqlQueryPlan => ({
      ast,
      params: [] as unknown as SqlQueryPlan['params'],
      meta: {
        target: 'postgres',
        storageHash: CONTRACT_HASH,
        lane: 'sql',
      } as unknown as SqlQueryPlan['meta'],
    });

    const op = dataTransformAst(
      makeContract(),
      'vector-backfill',
      { run: () => makePlan() },
      makeAdapter(),
    );

    const opsJson = JSON.parse(JSON.stringify(op));
    const roundTripped = parseAnyQueryAst(opsJson.execute[0].meta.ast, makeRegistry());
    expect(roundTripped).toBeInstanceOf(UpdateAst);
    const update = roundTripped as UpdateAst;
    expect((update.set['embedding'] as ParamRef).codec).toEqual(codec);
  });

  it('wraps check into precheck/postcheck with AST-bound steps', () => {
    const checkAst = SelectAst.from(TableSource.named('user'))
      .addProjection('id', ColumnRef.of('user', 'id'))
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'name'), LiteralExpr.of(null)));

    const runAst = UpdateAst.table(TableSource.named('user')).withSet({
      name: ParamRef.of('Anonymous', { codec: { codecId: 'pg/text@1' } }),
    });

    const op = dataTransformAst(
      makeContract(),
      'with-check',
      {
        check: () => ({
          ast: checkAst,
          params: [] as unknown as SqlQueryPlan['params'],
          meta: {
            target: 'postgres',
            storageHash: CONTRACT_HASH,
            lane: 'sql',
          } as unknown as SqlQueryPlan['meta'],
        }),
        run: () => ({
          ast: runAst,
          params: [] as unknown as SqlQueryPlan['params'],
          meta: {
            target: 'postgres',
            storageHash: CONTRACT_HASH,
            lane: 'sql',
          } as unknown as SqlQueryPlan['meta'],
        }),
      },
      makeAdapter(),
    );

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.meta!['ast']).toBeDefined();
    expect(op.postcheck).toHaveLength(1);
    expect(op.postcheck[0]!.meta!['ast']).toBeDefined();
    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]!.meta!['ast']).toBeDefined();
  });

  it('supports multiple run closures', () => {
    const makeRunPlan = (name: string): SqlQueryPlan => ({
      ast: UpdateAst.table(TableSource.named('user')).withSet({
        [name]: ParamRef.of('x', { codec: { codecId: 'pg/text@1' } }),
      }),
      params: [] as unknown as SqlQueryPlan['params'],
      meta: {
        target: 'postgres',
        storageHash: CONTRACT_HASH,
        lane: 'sql',
      } as unknown as SqlQueryPlan['meta'],
    });

    const op = dataTransformAst(
      makeContract(),
      'multi',
      { run: [() => makeRunPlan('a'), () => makeRunPlan('b')] },
      makeAdapter(),
    );

    expect(op.execute).toHaveLength(2);
    expect(op.execute[0]!.meta!['ast']).toBeDefined();
    expect(op.execute[1]!.meta!['ast']).toBeDefined();
  });

  it('throws when storageHash does not match the contract', () => {
    const ast = UpdateAst.table(TableSource.named('user')).withSet({
      name: ParamRef.of('x', { codec: { codecId: 'pg/text@1' } }),
    });

    expect(() =>
      dataTransformAst(
        makeContract(),
        'mismatched',
        {
          run: () => ({
            ast,
            params: [] as unknown as SqlQueryPlan['params'],
            meta: {
              target: 'postgres',
              storageHash: 'sha256:wrong-hash',
              lane: 'sql',
            } as unknown as SqlQueryPlan['meta'],
          }),
        },
        makeAdapter(),
      ),
    ).toThrow();
  });

  it('accepts a Buildable by calling build() once', () => {
    const ast = UpdateAst.table(TableSource.named('user')).withSet({
      name: ParamRef.of('x', { codec: { codecId: 'pg/text@1' } }),
    });

    const build = vi.fn(
      (): SqlQueryPlan => ({
        ast,
        params: [] as unknown as SqlQueryPlan['params'],
        meta: {
          target: 'postgres',
          storageHash: CONTRACT_HASH,
          lane: 'sql',
        } as unknown as SqlQueryPlan['meta'],
      }),
    );

    const op = dataTransformAst(
      makeContract(),
      'from-buildable',
      { run: () => ({ build }) },
      makeAdapter(),
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(op.execute).toHaveLength(1);
  });

  it('forwards invariantId onto the op when supplied', () => {
    const makePlan = (): SqlQueryPlan => ({
      ast: UpdateAst.table(TableSource.named('user')).withSet({
        name: ParamRef.of('x', { codec: { codecId: 'pg/text@1' } }),
      }),
      params: [] as unknown as SqlQueryPlan['params'],
      meta: {
        target: 'postgres',
        storageHash: CONTRACT_HASH,
        lane: 'sql',
      } as unknown as SqlQueryPlan['meta'],
    });

    const op = dataTransformAst(
      makeContract(),
      'with-invariant',
      { invariantId: 'backfill-user-name', run: () => makePlan() },
      makeAdapter(),
    );

    expect(op.invariantId).toBe('backfill-user-name');
  });
});
