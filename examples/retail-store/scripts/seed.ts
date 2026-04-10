import { existsSync } from 'node:fs';
import { createClient } from '../src/db';
import { seed } from '../src/seed';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const DB_NAME = 'retail_store';

async function main() {
  const url = process.env['MONGODB_URL'];
  if (!url) {
    console.error('MONGODB_URL is required. Set it in your environment or .env file.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  const db = await createClient(url, DB_NAME);

  try {
    console.log('Seeding data...');
    await seed(db);
    console.log('Seed complete.');
  } finally {
    await db.runtime.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
