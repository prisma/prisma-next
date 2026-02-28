import pgvector from '@prisma-next/extension-pgvector/runtime';
import type { KyselifyContract } from '@prisma-next/integration-kysely';
import postgres from '@prisma-next/postgres/runtime';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { budgets } from '@prisma-next/sql-runtime';
import type { CompiledQuery, Kysely } from 'kysely';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  extensions: [pgvector],
  plugins: [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
});

type DemoDb = KyselifyContract<Contract>;
type InferCompiledRow<T> = T extends CompiledQuery<infer Row> ? Row : unknown;
type DemoBuildOnlyKysely = Kysely<DemoDb> & {
  build<TQuery extends { compile(): CompiledQuery<unknown> }>(
    query: TQuery,
  ): SqlQueryPlan<InferCompiledRow<ReturnType<TQuery['compile']>>>;
  readonly redactedSql: string;
};

export const kysely = db.kysely as unknown as DemoBuildOnlyKysely;
