import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { arktypeDb } from './db';

export async function createArktypeProfile(
  input: {
    label: string;
    profile: { displayName: string; age: number; newsletter: boolean };
  },
  runtime: Runtime,
) {
  const table = arktypeDb.schema.tables.arktype_profile;
  const columns = table.columns;
  const plan = arktypeDb.sql
    .insert(table, {
      label: param('label'),
      profile: param('profile'),
    })
    .returning(columns.id, columns.label, columns.profile)
    .build({ params: input });

  const rows: Array<{ id: string; label: string; profile: unknown }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; label: string; profile: unknown });
  }
  return rows[0];
}

export async function listArktypeProfiles(runtime: Runtime) {
  const table = arktypeDb.schema.tables.arktype_profile;
  const plan = arktypeDb.sql
    .from(table)
    .select({
      id: table.columns.id,
      label: table.columns.label,
      profile: table.columns.profile,
    })
    .limit(25)
    .build();

  const rows: Array<{ id: string; label: string; profile: unknown }> = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as { id: string; label: string; profile: unknown });
  }
  return rows;
}
