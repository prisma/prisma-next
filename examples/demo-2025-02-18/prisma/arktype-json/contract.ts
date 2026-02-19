import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { jsonb, textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { ulid } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { type as arktype } from 'arktype';

const profileSchema = arktype({
  displayName: 'string',
  age: 'number',
  meta: {
    username: 'string',
  },
});

export type Profile = typeof profileSchema.infer;

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('arktype_profile', (t) =>
    t
      .generated('id', ulid())
      .column('profile', {
        type: jsonb(profileSchema),
        //    ˆˆˆˆˆ new codec, supporting optional explicit schemas.
        // any standard-schema compatible library is supported.
        // This means you can use Zod, Arktype, Effect-Schema, etc.
        nullable: false,
      })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('label', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('ArktypeProfile', 'arktype_profile', (m) =>
    m
      .field('id', 'id')
      .field('label', 'label')
      .field('profile', 'profile')
      .field('createdAt', 'created_at'),
  )
  .capabilities({
    postgres: {
      returning: true,
      'defaults.now': true,
    },
  })
  .build();
