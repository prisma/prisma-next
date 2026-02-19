import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { nanoid as unikuNanoid } from 'uniku/nanoid';
import { idsDb } from './db';

export async function createNanoidRecord(name: string, runtime: Runtime) {
  const table = idsDb.schema.tables.id_nanoid_record;
  const columns = table.columns;
  const plan = idsDb.sql
    .insert(table, {
      name: param('name'),
    })
    .returning(columns.id, columns.name)
    .build({ params: { name } });

  const rows: Array<{ id: string; name: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; name: string });
  }
  return rows[0];
}

export async function createNanoidRecordWithOverride(name: string, runtime: Runtime) {
  const table = idsDb.schema.tables.id_nanoid_record;
  const columns = table.columns;
  const customId = unikuNanoid({ alphabet: 'abcdef0123456789' });
  const plan = idsDb.sql
    .insert(table, {
      id: param('id'),
      name: param('name'),
    })
    .returning(columns.id, columns.name)
    .build({ params: { id: customId, name } });

  const rows: Array<{ id: string; name: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; name: string });
  }
  return rows[0];
}

export async function createUlidRecord(note: string, runtime: Runtime) {
  const table = idsDb.schema.tables.id_ulid_record;
  const columns = table.columns;
  const plan = idsDb.sql
    .insert(table, {
      note: param('note'),
    })
    .returning(columns.id, columns.note)
    .build({ params: { note } });

  const rows: Array<{ id: string; note: string }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; note: string });
  }
  return rows[0];
}
