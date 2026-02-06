import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve SQLite "connection strings" to a filename.
 *
 * Supports:
 * - Absolute/relative paths (returned as-is / resolved by callers when desired)
 * - Standard file URLs: file:///absolute/path.db
 * - Prisma-style file URLs: file:./dev.db (resolved relative to process.cwd())
 */
export function resolveSqliteFilename(urlOrPath: string): string {
  if (!urlOrPath.startsWith('file:')) {
    return urlOrPath;
  }

  // Standard file URLs (file:///...) should be handled by the URL parser.
  if (urlOrPath.startsWith('file://')) {
    return fileURLToPath(new URL(urlOrPath));
  }

  // Prisma-style: file:./dev.db or file:../dev.db. The URL constructor incorrectly
  // normalizes these to file:///dev.db, so we treat them as "file:" + path.
  const rest = urlOrPath.slice('file:'.length);
  const pathPart = rest.split('?', 1)[0] ?? rest;
  if (pathPart === ':memory:') {
    return ':memory:';
  }

  // Resolve relative paths from the current working directory.
  return resolvePath(process.cwd(), decodeURIComponent(pathPart));
}
