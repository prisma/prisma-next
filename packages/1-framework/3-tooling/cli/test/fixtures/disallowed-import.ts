import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
// @ts-expect-error - This import is intentionally disallowed for testing
// biome-ignore lint/correctness/noUnusedImports: Intentionally unused for testing disallowed imports
import { something } from 'some-other-package';
import { postgresPack } from '../helpers/postgres-pack';

export const contract = defineContract<Record<string, never>>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();
