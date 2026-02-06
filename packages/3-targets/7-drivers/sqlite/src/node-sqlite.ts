import type { PathLike } from 'node:fs';
import { createRequire } from 'node:module';

// Keep this in a helper module so we have a single place to work around bundler behavior.
//
// esbuild (used by tsup) strips the `node:` prefix from builtin imports. For `node:sqlite`
// that produces `sqlite`, which Node does NOT treat as a builtin module specifier.
//
// To avoid that rewrite, we load the module via `require()` with a runtime-built specifier.

type NodeSqliteModule = typeof import('node:sqlite');

export type DatabaseSync = import('node:sqlite').DatabaseSync;
export type DatabaseSyncOptions = import('node:sqlite').DatabaseSyncOptions;

const require = createRequire(import.meta.url);

function loadNodeSqlite(): NodeSqliteModule {
  // Avoid a literal `node:sqlite` string to prevent build-time rewriting.
  const name = String.fromCharCode(115, 113, 108, 105, 116, 101); // "sqlite"
  return require(`node:${name}`) as NodeSqliteModule;
}

export function createDatabaseSync(path: PathLike, options?: DatabaseSyncOptions): DatabaseSync {
  const { DatabaseSync: DatabaseSyncCtor } = loadNodeSqlite();
  // node:sqlite is strict about the constructor arity. Passing `undefined` as the 2nd
  // argument throws; omit it when unset.
  return (
    options === undefined ? new DatabaseSyncCtor(path) : new DatabaseSyncCtor(path, options)
  ) as DatabaseSync;
}
