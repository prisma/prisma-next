import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { cuid2 } from 'uniku/cuid2';
// Note: eventually, we'll be able to import the generated JSON types from contract.d.ts directly
import type { EventPayload } from '../prisma/zod-discriminated-union/contract';
import { zodDb } from './zod-discriminated-union/db';

const table = zodDb.schema.tables.zod_event;
const columns = table.columns;

async function insertEvent(runtime: Runtime, input: { source: string; event: EventPayload }) {
  const plan = zodDb.sql
    .insert(table, { source: param('source'), event: param('event') })
    .returning(columns.id, columns.source, columns.event)
    .build({ params: input });

  const rows = await runtime.execute(plan).toArray();
  return rows[0];
}

async function listEvents(runtime: Runtime) {
  const plan = zodDb.sql
    .from(table)
    .select({ id: columns.id, source: columns.source, event: columns.event })
    .limit(25)
    .build();

  const rows = await runtime.execute(plan).toArray();
  return rows;
}

async function main() {
  const runtime = zodDb.runtime();
  try {
    const userId = cuid2();

    const payloads = [
      {
        _tag: 'user.created',
        userId,
        email: 'schiabel@prisma.io',
      },
      {
        _tag: 'post.published',
        postId: cuid2(),
        authorId: userId,
      },
      {
        _tag: 'payment.captured',
        paymentId: cuid2(),
        amountCents: 4_200,
      },
    ] satisfies EventPayload[];

    for (const payload of payloads) {
      await insertEvent(runtime, {
        source: 'demo-json-union',
        event: payload,
      });
    }

    const events = await listEvents(runtime);

    // You gain type-safe access to discriminated JSON fields, like `event`!
    //
    // if (events[0]?.event._tag === 'user.created') {
    //   const user = events[0]?.event;
    //   user.email;
    // }

    console.log(JSON.stringify(events, null, 2));
  } finally {
    await runtime.close();
  }
}

await main();
