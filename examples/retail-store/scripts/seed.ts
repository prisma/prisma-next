import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '../src/db';
import { seed } from '../src/seed';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function upsertEnvVar(filePath: string, key: string, value: string) {
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + line + '\n';
  }

  writeFileSync(filePath, content, 'utf-8');
}

async function main() {
  const url = process.env['MONGODB_URL'];
  if (!url) {
    console.error('MONGODB_URL is required. Set it in your environment or .env file.');
    process.exit(1);
  }

  const dbName = process.env['MONGODB_DB'] ?? 'retail_store';

  console.log('Connecting to MongoDB...');
  const db = await createClient(url, dbName);

  try {
    console.log('Seeding data...');
    const { demoUserId } = await seed(db);

    upsertEnvVar('.env', 'DEMO_USER_ID', demoUserId);

    console.log(`Seed complete. DEMO_USER_ID=${demoUserId} written to .env`);
  } finally {
    await db.runtime.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
