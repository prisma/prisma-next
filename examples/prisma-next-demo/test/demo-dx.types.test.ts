/**
 * Type tests for demo DX with split Contract + TypeMaps.
 *
 * Verifies emitted workflow uses Contract and TypeMaps for correct lane inference,
 * and that runtime Contract value aligns with type (no HMR/type divergence).
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 */
import { validateContract } from '@prisma-next/sql-contract/validate';
import { expectTypeOf, test } from 'vitest';
import type { Contract, TypeMaps } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';

test('contract.d.ts exports Contract and TypeMaps separately', () => {
  expectTypeOf<Contract>().toHaveProperty('models');
  expectTypeOf<TypeMaps>().toHaveProperty('codecTypes');
  expectTypeOf<TypeMaps>().toHaveProperty('operationTypes');
});

test('emitted workflow postgres<Contract> produces typed schema and sql', () => {
  const userTable = db.schema.tables.user;
  expectTypeOf(userTable).not.toEqualTypeOf<never>();
  expectTypeOf(userTable.columns.id).not.toEqualTypeOf<never>();
  expectTypeOf(userTable.columns.email).not.toEqualTypeOf<never>();

  const plan = db.sql
    .from(userTable)
    .select({ id: userTable.columns.id, email: userTable.columns.email })
    .limit(5)
    .build();

  expectTypeOf(plan).not.toEqualTypeOf<never>();
});

test('validateContract<Contract> output is assignable to visualization shape', () => {
  const contract = validateContract<Contract>(contractJson);

  expectTypeOf(contract.models).toHaveProperty('User');
  expectTypeOf(contract.models).toHaveProperty('Post');
  expectTypeOf(contract.storage.tables).toHaveProperty('user');
  expectTypeOf(contract.storage.tables).toHaveProperty('post');
  expectTypeOf(contract.mappings.modelToTable).toHaveProperty('User');
  expectTypeOf(contract.mappings.tableToModel).toHaveProperty('user');
});
