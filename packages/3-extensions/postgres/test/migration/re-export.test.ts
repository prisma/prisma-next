import * as facadeMigration from '@prisma-next/postgres/migration';
import * as targetMigration from '@prisma-next/target-postgres/migration';
import { describe, expect, it } from 'vitest';

describe('@prisma-next/postgres/migration re-export parity', () => {
  it('re-exports all named exports from @prisma-next/target-postgres/migration', () => {
    const facadeKeys = Object.keys(facadeMigration).sort();
    const targetKeys = Object.keys(targetMigration).sort();
    expect(facadeKeys).toEqual(targetKeys);
  });

  it('re-exports Migration', () => {
    expect(facadeMigration.Migration).toBeDefined();
  });

  it('re-exports MigrationCLI', () => {
    expect(facadeMigration.MigrationCLI).toBeDefined();
  });

  it('re-exports placeholder', () => {
    expect(facadeMigration.placeholder).toBeDefined();
  });

  it('re-exports dataTransform', () => {
    expect(facadeMigration.dataTransform).toBeDefined();
  });

  // `createTable` / `createSchema` are no longer free exports — they are
  // `Migration` methods (`this.createTable({ ... })`) that lower a typed DDL
  // node through the adapter, so there is nothing to re-export here.

  it('re-exports addColumn', () => {
    expect(facadeMigration.addColumn).toBeDefined();
  });

  it('re-exports dropTable', () => {
    expect(facadeMigration.dropTable).toBeDefined();
  });

  it('re-exports rawSql', () => {
    expect(facadeMigration.rawSql).toBeDefined();
  });

  it('re-exports setNotNull', () => {
    expect(facadeMigration.setNotNull).toBeDefined();
  });

  it('re-exports createIndex', () => {
    expect(facadeMigration.createIndex).toBeDefined();
  });

  it('re-exports installExtension', () => {
    expect(facadeMigration.installExtension).toBeDefined();
  });
});
