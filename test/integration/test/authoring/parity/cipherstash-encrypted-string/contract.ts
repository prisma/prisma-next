/**
 * Cipherstash `EncryptedString` PSL ↔ TS authoring parity fixture.
 *
 * Originally added in M2 R2 T2.7 to cover AC-PARITY1..2 (cipherstash
 * arg-shape × nullability combinations). The same fixture covers the
 * cipherstash umbrella scenario`s contract.json parity requirement —
 * `projects/cipherstash-integration/project-1/spec.md § AC-UMB2`:
 *
 * > The same scenario authored via the TypeScript contract
 * > (`encryptedString({...})`) produces a `contract.json` byte-identical
 * > to the PSL version (parity test).
 *
 * The umbrella scenario`s sole encrypted column is the equivalent of
 * the `full` field below (`equality: true, freeTextSearch: true`) plus
 * the `optionalFull` field for the nullable variant (T3.7 / AC-UMB4).
 * Both shapes ride this fixture`s parity sweep through
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
