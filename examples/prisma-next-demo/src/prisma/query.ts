import { schema as schemaBuilder } from '@prisma-next/sql-query/schema';
import { validateContract } from '@prisma-next/sql-query/schema';
import { sql as sqlBuilder } from '@prisma-next/sql-query/sql';
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
