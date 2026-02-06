import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function withTempSqliteDatabase<T>(
  fn: (args: { readonly connectionString: string; readonly filename: string }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'prisma-next-sqlite-'));
  const filename = join(dir, 'db.sqlite');
  const connectionString = pathToFileURL(filename).href;

  try {
    return await fn({ connectionString, filename });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
