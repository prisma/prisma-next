import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  DatabaseMetadata,
  Dialect,
  Driver,
  Kysely,
  QueryCompiler,
  TransactionSettings,
} from 'kysely';
import { Kysely as KyselyClient, PostgresAdapter, PostgresQueryCompiler } from 'kysely';
import type { KyselifyContract } from './kyselify';
import { buildKyselyPlan, REDACTED_SQL } from './plan';
import { buildKyselyWhereExpr } from './where-expr';

type InferCompiledRow<TCompiled> = TCompiled extends CompiledQuery<infer Row> ? Row : unknown;
type InferBuildRow<TQuery extends { compile(): unknown }> = InferCompiledRow<
  ReturnType<TQuery['compile']>
>;

type BuildOnlyAuthoringMethod = 'selectFrom' | 'insertInto' | 'updateTable' | 'deleteFrom';
type BuildOnlyAuthoringSurface<DB> = Pick<Kysely<DB>, BuildOnlyAuthoringMethod>;

type BuildOnlyKyselyLane<DB> = BuildOnlyAuthoringSurface<DB> & {
  build<TQuery extends { compile(): unknown }>(query: TQuery): SqlQueryPlan<InferBuildRow<TQuery>>;
  whereExpr<TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr;
  readonly redactedSql: string;
};

export type KyselyQueryLane<TContract extends SqlContract<SqlStorage>> = BuildOnlyKyselyLane<
  KyselifyContract<TContract>
>;

const BUILD_ONLY_EXECUTION_MESSAGE =
  'Kysely execution is disabled for db.kysely (build-only surface). Build a plan with db.kysely.build(query) and execute it through runtime.';

class BuildOnlyKyselyDriver implements Driver {
  async init(): Promise<void> {}
  async destroy(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async beginTransaction(
    _connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async commitTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class RedactingPostgresQueryCompiler implements QueryCompiler {
  readonly #compiler = new PostgresQueryCompiler();
  compileQuery(
    ...args: Parameters<PostgresQueryCompiler['compileQuery']>
  ): ReturnType<PostgresQueryCompiler['compileQuery']> {
    const [node, queryId] = args;
    const compiled = this.#compiler.compileQuery(node, queryId);
    return {
      ...compiled,
      sql: REDACTED_SQL,
    };
  }
}

class BuildOnlyPostgresDialect implements Dialect {
  createAdapter = () => new PostgresAdapter();
  createDriver = () => new BuildOnlyKyselyDriver();
  createIntrospector = (): DatabaseIntrospector => {
    const msg =
      'Introspection is not supported on the build-only Kysely dialect. Use the runtime schema API instead.';
    return {
      getSchemas: async () => {
        throw new Error(msg);
      },
      getTables: async () => {
        throw new Error(msg);
      },
      getMetadata: async (): Promise<DatabaseMetadata> => {
        throw new Error(msg);
      },
    };
  };
  createQueryCompiler = () => new RedactingPostgresQueryCompiler();
}

export function createBuildOnlyKyselyLane<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): KyselyQueryLane<TContract> {
  const base = new KyselyClient<KyselifyContract<TContract>>({
    dialect: new BuildOnlyPostgresDialect(),
  });
  const lane = base as unknown as KyselyQueryLane<TContract>;
  Object.defineProperty(lane, 'build', {
    value: <TQuery extends { compile(): unknown }>(query: TQuery) =>
      buildKyselyPlan(contract, query.compile() as CompiledQuery<InferBuildRow<TQuery>>, {
        lane: 'kysely',
      }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(lane, 'whereExpr', {
    value: <TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr =>
      buildKyselyWhereExpr(contract, query.compile() as CompiledQuery<InferBuildRow<TQuery>>, {
        lane: 'kysely',
      }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(lane, 'redactedSql', {
    value: REDACTED_SQL,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return lane;
}
