import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

export type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
export type KyselyLaneContract = SqlContract<SqlStorage>;
export type KyselyLanePlan<Row> = SqlQueryPlan<Row>;
