import { schema as schemaBuilder, validateContract } from '@prisma-next/sql-query/schema';
import { sql as sqlBuilder } from '@prisma-next/sql-query/sql';
import { adapter } from './adapter';
import type { CodecTypes, Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };
import { getContext } from './runtime';

const contract = validateContract<Contract>(contractJson);

export const sql = sqlBuilder<Contract, CodecTypes>({
  contract,
  adapter,
});

export const schema = schemaBuilder<Contract, CodecTypes>(contract, getContext());
