import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/create-default-date/generated/contract';
import contractJson from '../../_fixtures/create-default-date/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/create-default-date
// (postgres matrix entry).
//
// The source suite creates a Visit record with no explicit data and asserts
// that visitTime is a Date. Both id (autoincrement via serial) and visitTime
// (defaultSql now()) are DB-generated, so create input is empty.

const DDL = [
  'create sequence "Visit_id_seq"',
  'create table "Visit" ("id" integer primary key default nextval(\'"Visit_id_seq"\'), "visitTime" timestamptz not null default now())',
];

describe('ports/prisma/functional/create-default-date', () => {
  it(
    'correctly creates a field with default date',
    () =>
      withPostgresPort<Contract>({ contractJson, ddl: DDL }, async ({ db }) => {
        const visit = await db.public.Visit.create({});
        expect(visit.visitTime).toBeInstanceOf(Date);
      }),
    timeouts.spinUpPpgDev,
  );
});
