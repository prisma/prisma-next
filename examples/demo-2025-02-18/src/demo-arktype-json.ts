import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Profile } from '../prisma/arktype-json/contract';
import { arktypeDb } from './arktype-json/db';

const table = arktypeDb.schema.tables.arktype_profile;
const columns = table.columns;

async function insertProfile(runtime: Runtime, input: { label: string; profile: Profile }) {
  const plan = arktypeDb.sql
    .insert(table, { label: param('label'), profile: param('profile') })
    .returning(columns.id, columns.label, columns.profile)
    .build({ params: input });

  const rows = await runtime.execute(plan).toArray();
  return rows[0];
}

async function listProfiles(runtime: Runtime) {
  const plan = arktypeDb.sql
    .from(table)
    .select({ id: columns.id, label: columns.label, profile: columns.profile })
    .limit(25)
    .build();

  const rows = await runtime.execute(plan).toArray();
  return rows;
}

async function main() {
  const runtime = arktypeDb.runtime();
  try {
    const created = await insertProfile(runtime, {
      label: 'demo-json',
      profile: {
        displayName: 'jkomyno',
        age: 28,
        meta: {
          username: 'jkomyno',
        },
      },
    });
    const all = await listProfiles(runtime);

    // You gain type-safe access to JSON fields, like `profile`!
    //
    // all[0]?.profile.displayName

    console.log(JSON.stringify({ created, all }, null, 2));
  } finally {
    await runtime.close();
  }
}

await main();
