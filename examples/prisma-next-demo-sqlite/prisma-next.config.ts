import 'dotenv/config';
import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sqlitevector from '@prisma-next/extension-sqlite-vector/control';
import sql from '@prisma-next/family-sql/control';
import sqlite from '@prisma-next/target-sqlite/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: sqlite,
  driver: sqliteDriver,
  adapter: sqliteAdapter,
  extensionPacks: [sqlitevector],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
  },
  db: {
    // biome-ignore lint/style/noNonNullAssertion: loaded from .env
    connection: process.env['DATABASE_URL']!,
  },
});
