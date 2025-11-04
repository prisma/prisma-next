import { sql as sqlBuilder } from '@prisma-next/sql/sql';
import { schema as schemaBuilder } from '@prisma-next/sql/schema';
import { CodecTypes, Contract } from './contract';
import contractJson from './contract.json' assert { type: 'json' };
import { adapter } from './adapter';
import { validateContract } from '@prisma-next/sql/schema';

const contract = validateContract<Contract>(contractJson);

export const sql = sqlBuilder<Contract, CodecTypes>({
  contract,
  adapter,
});

export const schema = schemaBuilder<Contract, CodecTypes>(contract);
