import 'dotenv/config';
import { existsSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveSqliteFilename(urlOrPath: string): string {
  if (!urlOrPath.startsWith('file:')) {
    return urlOrPath;
  }

  if (urlOrPath.startsWith('file://')) {
    return fileURLToPath(new URL(urlOrPath));
  }

  const rest = urlOrPath.slice('file:'.length);
  const pathPart = rest.split('?', 1)[0] ?? rest;
  if (pathPart === ':memory:') {
    return ':memory:';
  }

  return resolvePath(process.cwd(), decodeURIComponent(pathPart));
}

function dropSqliteDatabaseFile(urlOrPath: string): void {
  const filename = resolveSqliteFilename(urlOrPath);

  // Clean up sqlite sidecar files too.
  const files = [filename, `${filename}-wal`, `${filename}-shm`, `${filename}-journal`];

  let removedAny = false;
  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }
    rmSync(file);
    removedAny = true;
    // eslint-disable-next-line no-console
    console.log(`✔ Removed ${file}`);
  }

  if (!removedAny) {
    // eslint-disable-next-line no-console
    console.log('No database file found to remove.');
  }
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

if (databaseUrl === ':memory:') {
  // eslint-disable-next-line no-console
  console.log('DATABASE_URL is :memory:, nothing to remove');
  process.exit(0);
}

dropSqliteDatabaseFile(databaseUrl);
