import { createRequire } from 'node:module';

// Keep this in a helper module so we have a single place to dynamically load bun:sqlite.
//
// This package is built for Node (tsup/esbuild) and must not have a static dependency on
// `bun:sqlite` (which Node cannot resolve). We therefore load it via `require()` with a
// runtime-built specifier, similar to the `node:sqlite` workaround in node-sqlite.ts.

type BunSqliteModule = {
  readonly Database: new (filename: string, options?: Record<string, unknown>) => BunDatabase;
};

export type BunStatement = {
  readonly columnNames: readonly string[];
  all: (...params: unknown[]) => unknown[];
  iterate: (...params: unknown[]) => Iterable<unknown>;
  run: (...params: unknown[]) => { readonly changes: number; readonly lastInsertRowid: number };
  get: (...params: unknown[]) => unknown;
};

export type BunDatabase = {
  prepare: (sql: string) => BunStatement;
  exec: (sql: string) => void;
  close: () => void;
};

const require = createRequire(import.meta.url);

function loadBunSqlite(): BunSqliteModule {
  // Avoid a literal `bun:sqlite` string to reduce the chance of build-time rewriting.
  const bun = String.fromCharCode(98, 117, 110); // "bun"
  const sqlite = String.fromCharCode(115, 113, 108, 105, 116, 101); // "sqlite"
  return require(`${bun}:${sqlite}`) as BunSqliteModule;
}

export type BunDatabaseOptions = {
  readonly readonly?: boolean;
  readonly create?: boolean;
  readonly readwrite?: boolean;
};

export function createBunDatabase(filename: string, options?: BunDatabaseOptions): BunDatabase {
  const { Database } = loadBunSqlite();
  // Bun requires specifying a mode when passing options. Default to readwrite.
  const open = options
    ? Object.freeze({
        readwrite: options.readwrite ?? !options.readonly,
        readonly: options.readonly ?? false,
        create: options.create ?? true,
      })
    : undefined;
  return (open ? new Database(filename, open) : new Database(filename)) as BunDatabase;
}
