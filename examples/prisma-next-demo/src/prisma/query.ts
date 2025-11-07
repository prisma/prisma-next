import { orm as ormBuilder } from '@prisma-next/sql-query/orm';
import { schema as schemaBuilder, validateContract } from '@prisma-next/sql-query/schema';
import { sql as sqlBuilder } from '@prisma-next/sql-query/sql';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-query/types';
import { adapter } from './adapter';
import type { CodecTypes, Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

export const sql = sqlBuilder<Contract, CodecTypes>({
  contract,
  adapter,
});

export const schema = schemaBuilder<Contract, CodecTypes>(contract);
export const tables = schema.tables;

export const orm = ormBuilder<Contract, CodecTypes>({
  contract,
  adapter: adapter as Adapter<SelectAst, Contract, LoweredStatement>,
  codecTypes: {} as CodecTypes,
});
