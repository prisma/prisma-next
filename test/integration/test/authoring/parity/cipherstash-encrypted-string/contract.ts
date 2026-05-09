/**
 * Cipherstash `EncryptedString` PSL ↔ TS authoring parity fixture.
 *
 * Covers cipherstash arg-shape × nullability combinations and verifies TS contract authoring produces a
 * `contract.json` byte-identical to the PSL version. Maintainer-facing acceptance notes live in
 * `packages/3-extensions/cipherstash/DEVELOPING.md § Acceptance criteria`.
 *
 * The umbrella scenario`s sole encrypted column is the equivalent of
 * the `full` field below (`equality: true, freeTextSearch: true`) plus
 * the `optionalFull` field for the nullable variant. Both
 * shapes ride this fixture`s parity sweep through
 * `cli.emit-parity-fixtures.test.ts`, which asserts byte-identical
 * `contract.json` (plus matching `storageHash` / `profileHash` /
 * `executionHash`) between the PSL and TS authoring sides on every
 * run — no separate cipherstash-package umbrella parity test is required.
 */
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        // Both flags default to `true`. Users opt out of either or
        // both explicitly; the canonicalizer strips `false` values, so
        // the descriptors below emit the same `typeParams` shapes as
        // the previous explicit-`true` matrix.
        storageOnly: field.column(encryptedString({ equality: false, freeTextSearch: false })),
        equality: field.column(encryptedString({ freeTextSearch: false })),
        full: field.column(encryptedString()),
        optionalStorageOnly: field
          .column(encryptedString({ equality: false, freeTextSearch: false }))
          .optional(),
        optionalEquality: field.column(encryptedString({ freeTextSearch: false })).optional(),
        optionalFull: field.column(encryptedString()).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
