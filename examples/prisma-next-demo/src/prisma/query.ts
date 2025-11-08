import { orm as ormBuilder } from '@prisma-next/sql-query/orm';
import { schema as schemaBuilder, validateContract } from '@prisma-next/sql-query/schema';
import { sql as sqlBuilder } from '@prisma-next/sql-query/sql';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-query/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { adapter } from './adapter';
import type { CodecTypes, Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };
import { getContext } from './runtime';

const contract = validateContract<Contract>(contractJson as unknown as SqlContract<SqlStorage>);

export const sql = sqlBuilder<Contract, CodecTypes>({
  contract: contract as unknown as SqlContract<SqlStorage>,
  adapter,
});

export const schema = schemaBuilder<Contract, CodecTypes>(
  contract as unknown as SqlContract<SqlStorage>,
  getContext(),
);
export const tables = schema.tables;

export const orm = ormBuilder<Contract, CodecTypes>({
  contract: contract as unknown as SqlContract<SqlStorage>,
  adapter: adapter as unknown as Adapter<SelectAst, Contract, LoweredStatement>,
  codecTypes: {} as CodecTypes,
});
