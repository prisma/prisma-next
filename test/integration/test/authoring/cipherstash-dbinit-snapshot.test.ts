/**
 * AC-LOWER4 — `dbInit` plan against a contract carrying a
 * `cipherstash.EncryptedString`-typed column renders the column's
 * native type as `eql_v2_encrypted`. Pure SQL-shape snapshot; no live
 * Postgres required (the live-DB equivalent is exercised by M2.c's
 * EQL integration tests).
 *
 * The snapshot drives the postgres-adapter DDL builder
 * (`buildCreateTableSql`) directly with a synthesised
 * `StorageTable` whose columns mirror what cipherstash's authoring
 * layer lowers to. This gives us a deterministic byte-equal
 * assertion on the SQL the migration planner would produce, without
 * needing to spin up a database.
 */

import cipherstashControl from '@prisma-next/extension-cipherstash/control';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageTable } from '@prisma-next/sql-contract/types';
import { buildCreateTableSql } from '@prisma-next/target-postgres/planner-ddl-builders';
import { describe, expect, it } from 'vitest';

// Real cipherstash control-plane hooks pulled from the extension
// descriptor so the snapshot also pins the cipherstash extension's
// "search-mode typeParams do not affect DDL" decision in
// `exports/control.ts` — i.e. the column's SQL signature is always
// `eql_v2_encrypted`, regardless of `equality` / `freeTextSearch`.
const codecHooks = new Map<string, CodecControlHooks>(
  Object.entries(cipherstashControl.types?.codecTypes?.controlPlaneHooks ?? {}),
);

function cipherstashColumn(typeParams: Record<string, unknown>, nullable: boolean) {
  return {
    codecId: 'cipherstash/string@1',
    nativeType: 'eql_v2_encrypted',
    nullable,
    typeParams,
  } as const;
}

const encryptedDocStorage: StorageTable = {
  columns: {
    id: {
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      nullable: false,
      default: { kind: 'function', expression: 'autoincrement()' },
    },
    storageOnly: cipherstashColumn({}, false),
    equalityOnly: cipherstashColumn({ equality: true }, false),
    searchable: cipherstashColumn({ equality: true, freeTextSearch: true }, false),
    storageOnlyOpt: cipherstashColumn({}, true),
    equalityOnlyOpt: cipherstashColumn({ equality: true }, true),
    searchableOpt: cipherstashColumn({ equality: true, freeTextSearch: true }, true),
  },
  primaryKey: { columns: ['id'] },
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

describe('cipherstash dbInit DDL snapshot (AC-LOWER4)', () => {
  it('renders cipherstash columns with native type eql_v2_encrypted', () => {
    const ddl = buildCreateTableSql('"public"."encrypted_doc"', encryptedDocStorage, codecHooks);

    // Each cipherstash-typed column must use the unparameterised
    // eql_v2_encrypted native type — typeParams are search-mode
    // metadata, not DDL adornments.
    expect(ddl).toContain('"storageOnly" eql_v2_encrypted NOT NULL');
    expect(ddl).toContain('"equalityOnly" eql_v2_encrypted NOT NULL');
    expect(ddl).toContain('"searchable" eql_v2_encrypted NOT NULL');
    expect(ddl).toContain('"storageOnlyOpt" eql_v2_encrypted');
    expect(ddl).toContain('"equalityOnlyOpt" eql_v2_encrypted');
    expect(ddl).toContain('"searchableOpt" eql_v2_encrypted');

    // Make sure we don't accidentally render a parameterised form
    // (e.g. eql_v2_encrypted(true)).
    expect(ddl).not.toMatch(/eql_v2_encrypted\(/);
  });

  it('matches a stable byte-exact CREATE TABLE snapshot', () => {
    const ddl = buildCreateTableSql('"public"."encrypted_doc"', encryptedDocStorage, codecHooks);
    expect(ddl).toBe(
      [
        'CREATE TABLE "public"."encrypted_doc" (',
        '  "id" SERIAL NOT NULL,',
        '  "storageOnly" eql_v2_encrypted NOT NULL,',
        '  "equalityOnly" eql_v2_encrypted NOT NULL,',
        '  "searchable" eql_v2_encrypted NOT NULL,',
        '  "storageOnlyOpt" eql_v2_encrypted,',
        '  "equalityOnlyOpt" eql_v2_encrypted,',
        '  "searchableOpt" eql_v2_encrypted,',
        '  PRIMARY KEY ("id")',
        ')',
      ].join('\n'),
    );
  });
});
