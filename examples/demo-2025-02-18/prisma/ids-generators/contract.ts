import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { nanoid, ulid } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('id_nanoid_record', (t) =>
    t
      .generated('id', nanoid({ alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' }))
      // ^^^^^^^
      // New default column with client-side unique ID generation.
      // Each module imported from `@prisma-next/ids` brings their own codec.
      // We support uuid (v4, v7), ulid, cuid2, nanoid, and ksuid.
      // Some ID generators support custom parameters, like `nanoid`.
      .column('name', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id']),
  )
  .table('id_ulid_record', (t) =>
    t
      .generated('id', ulid())
      // ^^^^^^^ These columns can be overridden by the user, in which case we skip running the defined generator.
      .column('note', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id']),
  )
  .model('IdNanoidRecord', 'id_nanoid_record', (m) =>
    m.field('id', 'id').field('name', 'name').field('createdAt', 'created_at'),
  )
  .model('IdUlidRecord', 'id_ulid_record', (m) =>
    m.field('id', 'id').field('note', 'note').field('createdAt', 'created_at'),
  )
  .capabilities({
    postgres: {
      returning: true,
      'defaults.now': true,
    },
  })
  .build();
