import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { zodDb } from './db';

type EventPayload =
  | { _tag: 'user.created'; userId: string; email: string }
  | { _tag: 'post.published'; postId: string; authorId: string }
  | { _tag: 'payment.captured'; paymentId: string; amountCents: number };

export async function createZodEvent(
  input: { source: string; event: EventPayload },
  runtime: Runtime,
) {
  const table = zodDb.schema.tables.zod_event;
  const columns = table.columns;
  const plan = zodDb.sql
    .insert(table, {
      source: param('source'),
      event: param('event'),
    })
    .returning(columns.id, columns.source, columns.event)
    .build({ params: input });

  const rows: Array<{ id: string; source: string; event: EventPayload }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as unknown as { id: string; source: string; event: EventPayload });
  }
  return rows[0];
}

export async function listZodEvents(runtime: Runtime) {
  const table = zodDb.schema.tables.zod_event;
  const plan = zodDb.sql
    .from(table)
    .select({
      id: table.columns.id,
      source: table.columns.source,
      event: table.columns.event,
    })
    .limit(25)
    .build();

  const rows: Array<{ id: string; source: string; event: EventPayload }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as unknown as { id: string; source: string; event: EventPayload });
  }
  return rows;
}
