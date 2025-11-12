import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  readContractMarker,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { Client } from 'pg';

export interface StampMarkerOptions {
  readonly connectionString: string;
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly appTag?: string;
  readonly meta?: Record<string, unknown>;
}

export async function stampMarker(options: StampMarkerOptions) {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();

  try {
    await client.query(ensureSchemaStatement.sql);
    await client.query(ensureTableStatement.sql);

    const read = readContractMarker();
    const result = await client.query(read.sql, [...read.params]);
    const write = writeContractMarker({
      coreHash: options.coreHash,
      profileHash: options.profileHash,
      contractJson: options.contractJson,
      canonicalVersion: options.canonicalVersion ?? 1,
      ...(options.appTag !== undefined ? { appTag: options.appTag } : {}),
      ...(options.meta !== undefined ? { meta: options.meta } : {}),
    });

    if (result.rows.length === 0) {
      await client.query(write.insert.sql, [...write.insert.params]);
    } else {
      await client.query(write.update.sql, [...write.update.params]);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Read contract.json from src/prisma/contract.json relative to this script
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const contractJsonPath = join(scriptDir, '../src/prisma/contract.json');
  const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as {
    coreHash?: string;
    profileHash?: string;
  };

  const coreHash = contractJson.coreHash;
  const profileHash = contractJson.profileHash;

  if (!coreHash || !profileHash) {
    console.error(`Contract JSON at ${contractJsonPath} is missing coreHash or profileHash`);
    process.exit(1);
  }

  stampMarker({ connectionString, coreHash, profileHash, contractJson }).then(
    () => {
      console.log('Marker stamped');
    },
    (error) => {
      console.error('Failed to stamp marker');
      console.error(error);
      process.exit(1);
    },
  );
}
