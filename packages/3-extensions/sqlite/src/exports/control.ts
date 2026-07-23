import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@prisma-next/cli/control-api';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sql from '@prisma-next/family-sql/control';
import sqlite from '@prisma-next/target-sqlite/control';
import { ifDefined } from '@prisma-next/utils/defined';

export interface SqliteControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createSqliteControlClient(options: SqliteControlClientOptions = {}): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
