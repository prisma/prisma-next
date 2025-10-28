import { Client } from 'pg';

import { upsertMarker } from '@prisma/marker';

export interface StampMarkerOptions {
  readonly connectionString: string;
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
}

export async function stampMarker(options: StampMarkerOptions) {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();

  try {
    await upsertMarker(client, {
      coreHash: options.coreHash,
      profileHash: options.profileHash,
      contractJson: options.contractJson,
      canonicalVersion: options.canonicalVersion ?? 1,
    });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  const coreHash = process.env.CONTRACT_CORE_HASH;
  const profileHash = process.env.CONTRACT_PROFILE_HASH;

  if (!connectionString || !coreHash || !profileHash) {
    console.error(
      'DATABASE_URL, CONTRACT_CORE_HASH, and CONTRACT_PROFILE_HASH environment variables are required',
    );
    process.exit(1);
  }

  stampMarker({ connectionString, coreHash, profileHash }).then(
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
