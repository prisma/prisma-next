import type { ContractBase } from '@prisma-next/contract/types';
import type { Runtime } from '@prisma-next/sql-runtime';

export interface KyselyPrismaDialectConfig {
  contract: ContractBase;
  runtime: Runtime;
}
