import 'dotenv/config';
import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import sqlite from '@prisma-next/target-sqlite/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: sqlite,
  driver: sqliteDriver,
  adapter: sqliteAdapter,
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env['SQLITE_PATH'] ?? './demo.db',
  },
});
