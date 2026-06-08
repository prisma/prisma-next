import * as targetMigration from '@prisma-next/target-sqlite/migration';
import { describe, expect, it } from 'vitest';
import * as facadeMigration from '../../src/exports/migration';

describe('@prisma-next/sqlite/migration re-export parity', () => {
  it('re-exports all named exports from @prisma-next/target-sqlite/migration', () => {
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

  it('re-exports col', () => {
    expect(facadeMigration.col).toBeDefined();
  });

  it('re-exports lit', () => {
    expect(facadeMigration.lit).toBeDefined();
  });

  it('re-exports fn', () => {
    expect(facadeMigration.fn).toBeDefined();
  });

  it('re-exports primaryKey', () => {
    expect(facadeMigration.primaryKey).toBeDefined();
  });

  it('re-exports foreignKey', () => {
    expect(facadeMigration.foreignKey).toBeDefined();
  });

  it('re-exports unique', () => {
    expect(facadeMigration.unique).toBeDefined();
  });

  it('re-exports addColumn', () => {
    expect(facadeMigration.addColumn).toBeDefined();
  });

  it('re-exports dropTable', () => {
    expect(facadeMigration.dropTable).toBeDefined();
  });

  it('re-exports rawSql', () => {
    expect(facadeMigration.rawSql).toBeDefined();
  });

  it('re-exports createIndex', () => {
    expect(facadeMigration.createIndex).toBeDefined();
  });

  it('re-exports dropIndex', () => {
    expect(facadeMigration.dropIndex).toBeDefined();
  });

  it('re-exports dropColumn', () => {
    expect(facadeMigration.dropColumn).toBeDefined();
  });

  it('re-exports recreateTable', () => {
    expect(facadeMigration.recreateTable).toBeDefined();
  });
});
