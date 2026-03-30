import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { LoweredStatement } from '@prisma-next/sql-relational-core/ast';

export interface SqliteAdapterOptions {
  readonly profileId?: string;
}

export type SqliteContract = SqlContract<SqlStorage> & { readonly target: 'sqlite' };

export type SqliteLoweredStatement = LoweredStatement;
