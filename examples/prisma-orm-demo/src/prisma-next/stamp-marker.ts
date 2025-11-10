import {
  ensureSchemaStatement,
  ensureTableStatement,
  readContractMarker,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract } from '@prisma-next/sql-target';
import { Client } from 'pg';
import contract from './contract.json' with { type: 'json' };

const contractData = validateContract<SqlContract>(contract);

export async function stampMarker() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(ensureSchemaStatement.sql);
    await client.query(ensureTableStatement.sql);

    const read = readContractMarker();
    const result = await client.query(read.sql, [...read.params]);
    const write = writeContractMarker({
      coreHash: contractData.coreHash,
      profileHash: contractData.profileHash ?? contractData.coreHash,
      contractJson: contractData,
      canonicalVersion: 1,
    });

    if (result.rows.length === 0) {
      await client.query(write.insert.sql, [...write.insert.params]);
      console.log('Contract marker inserted');
    } else {
      await client.query(write.update.sql, [...write.update.params]);
      console.log('Contract marker updated');
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stampMarker().catch((error) => {
    console.error('Failed to stamp marker');
    console.error(error);
    process.exit(1);
  });
}
