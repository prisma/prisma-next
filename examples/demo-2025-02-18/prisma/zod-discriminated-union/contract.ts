import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { jsonb, textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { ulid } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { z } from 'zod';

const eventSchema = z.discriminatedUnion('_tag', [
  z.object({
    _tag: z.literal('user.created'),
    userId: z.string(),
    email: z.email(),
  }),
  z.object({
    _tag: z.literal('post.published'),
    postId: z.string(),
    authorId: z.string(),
  }),
  z.object({
    _tag: z.literal('payment.captured'),
    paymentId: z.string(),
    amountCents: z.number().int().positive(),
  }),
]);

export type EventPayload = z.infer<typeof eventSchema>;

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('zod_event', (t) =>
    t
      .generated('id', ulid())
      .column('event', {
        type: jsonb(eventSchema),
        //    ˆˆˆˆˆ You can even support a simple polymorphism in JSON fields
        //          by passing discriminated union schemas.
        nullable: false,
      })
      .column('source', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id']),
  )
  .model('ZodEvent', 'zod_event', (m) =>
    m
      .field('id', 'id')
      .field('source', 'source')
      .field('event', 'event')
      .field('createdAt', 'created_at'),
  )
  .capabilities({
    postgres: {
      returning: true,
      'defaults.now': true,
    },
  })
  .build();
