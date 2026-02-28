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

export interface BuildOnlyKyselyQuery<
  TQuery extends { compile(): unknown } = { compile(): unknown },
> {
  compile(): ReturnType<TQuery['compile']>;
  select(...args: unknown[]): BuildOnlyKyselyQuery;
  selectAll(...args: unknown[]): BuildOnlyKyselyQuery;
  where(...args: unknown[]): BuildOnlyKyselyQuery;
  orderBy(...args: unknown[]): BuildOnlyKyselyQuery;
  limit(...args: unknown[]): BuildOnlyKyselyQuery;
  offset(...args: unknown[]): BuildOnlyKyselyQuery;
  values(...args: unknown[]): BuildOnlyKyselyQuery;
  set(...args: unknown[]): BuildOnlyKyselyQuery;
  returning(...args: unknown[]): BuildOnlyKyselyQuery;
  returningAll(...args: unknown[]): BuildOnlyKyselyQuery;
  innerJoin(...args: unknown[]): BuildOnlyKyselyQuery;
  leftJoin(...args: unknown[]): BuildOnlyKyselyQuery;
  rightJoin(...args: unknown[]): BuildOnlyKyselyQuery;
  fullJoin(...args: unknown[]): BuildOnlyKyselyQuery;
}

export interface BuildOnlyKyselyLane<DB> {
  readonly __dbBrand?: DB;
  selectFrom(...args: unknown[]): BuildOnlyKyselyQuery;
  insertInto(...args: unknown[]): BuildOnlyKyselyQuery;
  updateTable(...args: unknown[]): BuildOnlyKyselyQuery;
  deleteFrom(...args: unknown[]): BuildOnlyKyselyQuery;
  build<TQuery extends { compile(): unknown }>(query: TQuery): SqlQueryPlan<InferBuildRow<TQuery>>;
  whereExpr<TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr;
  readonly redactedSql: string;
}

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

class BuildOnlyQueryWrapper<TQuery extends { compile(): unknown }>
  implements BuildOnlyKyselyQuery<TQuery>
{
  readonly #query: TQuery;

  constructor(query: TQuery) {
    this.#query = query;
  }

  compile(): ReturnType<TQuery['compile']> {
    return this.#query.compile() as ReturnType<TQuery['compile']>;
  }

  select(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('select', args);
  }

  selectAll(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('selectAll', args);
  }

  where(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('where', args);
  }

  orderBy(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('orderBy', args);
  }

  limit(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('limit', args);
  }

  offset(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('offset', args);
  }

  values(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('values', args);
  }

  set(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('set', args);
  }

  returning(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('returning', args);
  }

  returningAll(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('returningAll', args);
  }

  innerJoin(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('innerJoin', args);
  }

  leftJoin(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('leftJoin', args);
  }

  rightJoin(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('rightJoin', args);
  }

  fullJoin(...args: unknown[]): BuildOnlyKyselyQuery {
    return this.#chain('fullJoin', args);
  }

  #chain(method: string, args: unknown[]): BuildOnlyKyselyQuery {
    const fn = (this.#query as Record<string, unknown>)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Build-only Kysely query does not support method "${method}"`);
    }
    return wrapBuildOnlyQuery(
      (fn as (this: TQuery, ...fnArgs: unknown[]) => { compile(): unknown }).apply(
        this.#query,
        args,
      ),
    );
  }
}

function wrapBuildOnlyQuery<TQuery extends { compile(): unknown }>(
  query: TQuery,
): BuildOnlyKyselyQuery<TQuery> {
  return new BuildOnlyQueryWrapper(query);
}

export function createBuildOnlyKyselyLane<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): BuildOnlyKyselyLane<KyselifyContract<TContract>> {
  const base = new KyselyClient<KyselifyContract<TContract>>({
    dialect: new BuildOnlyPostgresDialect(),
  });

  return {
    selectFrom(...args: unknown[]): BuildOnlyKyselyQuery {
      return wrapBuildOnlyQuery(
        (
          base as unknown as { selectFrom: (...fnArgs: unknown[]) => { compile(): unknown } }
        ).selectFrom(...args),
      );
    },
    insertInto(...args: unknown[]): BuildOnlyKyselyQuery {
      return wrapBuildOnlyQuery(
        (
          base as unknown as { insertInto: (...fnArgs: unknown[]) => { compile(): unknown } }
        ).insertInto(...args),
      );
    },
    updateTable(...args: unknown[]): BuildOnlyKyselyQuery {
      return wrapBuildOnlyQuery(
        (
          base as unknown as { updateTable: (...fnArgs: unknown[]) => { compile(): unknown } }
        ).updateTable(...args),
      );
    },
    deleteFrom(...args: unknown[]): BuildOnlyKyselyQuery {
      return wrapBuildOnlyQuery(
        (
          base as unknown as { deleteFrom: (...fnArgs: unknown[]) => { compile(): unknown } }
        ).deleteFrom(...args),
      );
    },
    build<TQuery extends { compile(): unknown }>(
      query: TQuery,
    ): SqlQueryPlan<InferBuildRow<TQuery>> {
      return buildKyselyPlan(contract, query.compile() as CompiledQuery<InferBuildRow<TQuery>>, {
        lane: 'kysely',
      });
    },
    whereExpr<TQuery extends { compile(): unknown }>(query: TQuery): ToWhereExpr {
      return buildKyselyWhereExpr(
        contract,
        query.compile() as CompiledQuery<InferBuildRow<TQuery>>,
        {
          lane: 'kysely',
        },
      );
    },
    redactedSql: REDACTED_SQL,
  };
}
