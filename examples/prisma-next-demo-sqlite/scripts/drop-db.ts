import 'dotenv/config';
import { rmSync } from 'node:fs';

function dropDatabase() {
  const databasePath = process.env['SQLITE_PATH'] ?? './demo.db';

  try {
    rmSync(databasePath, { force: true });
    console.log(`✔ Removed database file: ${databasePath}`);

    // SQLite WAL/SHM sidecar files (if any).
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });

    console.log('\nDatabase reset complete');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

dropDatabase();
