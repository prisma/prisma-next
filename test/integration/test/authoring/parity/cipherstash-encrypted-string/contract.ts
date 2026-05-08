/**
 * Cipherstash `EncryptedString` PSL ↔ TS authoring parity fixture.
 *
 * Covers AC-PARITY1..2 (cipherstash arg-shape × nullability
 * combinations) and AC-UMB2 (TS contract authoring produces a
 * `contract.json` byte-identical to the PSL version). The canonical
 * cipherstash AC list lives in
 * `packages/3-extensions/cipherstash/DEVELOPING.md § Acceptance criteria`.
 *
 * The umbrella scenario`s sole encrypted column is the equivalent of
 * the `full` field below (`equality: true, freeTextSearch: true`) plus
 * the `optionalFull` field for the nullable variant (AC-UMB4). Both
 * shapes ride this fixture`s parity sweep through
 * `cli.emit-parity-fixtures.test.ts`, which asserts byte-identical
 * `contract.json` (plus matching `storageHash` / `profileHash` /
 * `executionHash`) between the PSL and TS authoring sides on every
 * run. AC-UMB2 is therefore covered here — no separate cipherstash-
 * package umbrella parity test is required.
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
        storageOnly: field.column(encryptedString({})),
        equality: field.column(encryptedString({ equality: true })),
        full: field.column(encryptedString({ equality: true, freeTextSearch: true })),
        optionalStorageOnly: field.column(encryptedString({})).optional(),
        optionalEquality: field.column(encryptedString({ equality: true })).optional(),
        optionalFull: field
          .column(encryptedString({ equality: true, freeTextSearch: true }))
          .optional(),
      },
    }).sql({ table: 'user' }),
  },
});
