import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { nanoid as unikuNanoid } from 'uniku/nanoid';
import { idsDb } from './ids-generators/db';

const nanoidTable = idsDb.schema.tables.id_nanoid_record;
const ulidTable = idsDb.schema.tables.id_ulid_record;

// The `id` column is generated client-side implicitly.
async function insertNanoidRecord(runtime: Runtime, name: string) {
  const plan = idsDb.sql
    .insert(nanoidTable, { name: param('name') })
    .returning(nanoidTable.columns.id, nanoidTable.columns.name)
    .build({ params: { name } });

  const rows = await runtime.execute(plan).toArray();
  return rows[0];
}

// The `id` column is generated client-side explicitly, with custom parameters.
async function insertNanoidRecordCustom(runtime: Runtime, name: string) {
  const customId = unikuNanoid({ alphabet: 'abcdef0123456789', size: 6 });
  const plan = idsDb.sql
    .insert(nanoidTable, { id: param('id'), name: param('name') })
    .returning(nanoidTable.columns.id, nanoidTable.columns.name)
    .build({ params: { id: customId, name } });

  const rows = await runtime.execute(plan).toArray();
  return rows[0];
}

async function insertUlidRecord(runtime: Runtime, note: string) {
  const plan = idsDb.sql
    .insert(ulidTable, { note: param('note') })
    .returning(ulidTable.columns.id, ulidTable.columns.note)
    .build({ params: { note } });

  const rows = await runtime.execute(plan).toArray();
  return rows[0];
}

async function main() {
  const runtime = idsDb.runtime();
  try {
    const nanoid = await insertNanoidRecord(runtime, 'nanoid');
    const nanoidCustom = await insertNanoidRecordCustom(runtime, 'nanoid-with-custom-params');
    const ulid = await insertUlidRecord(runtime, 'ulid');
    console.log(JSON.stringify({ nanoid, nanoidCustom, ulid }, null, 2));
  } finally {
    await runtime.close();
  }
}

await main();
