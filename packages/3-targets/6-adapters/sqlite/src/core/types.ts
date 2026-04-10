import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { LoweredStatement } from '@prisma-next/sql-relational-core/ast';

export interface SqliteAdapterOptions {
  readonly profileId?: string;
}

export type SqliteContract = Contract<SqlStorage> & { readonly target: 'sqlite' };

export type SqliteLoweredStatement = LoweredStatement;
