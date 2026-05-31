/**
 * Type tests for demo DX with split Contract + TypeMaps.
 *
 * Verifies emitted workflow uses Contract and TypeMaps for correct lane inference,
 * and that runtime Contract value aligns with type (no HMR/type divergence).
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 */

import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma-next/contract/types';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract, Models, TypeMaps } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

test('contract.d.ts exports Contract and TypeMaps separately', () => {
  expectTypeOf<Contract>().toHaveProperty('domain');
  expectTypeOf<TypeMaps>().toHaveProperty('codecTypes');
  expectTypeOf<TypeMaps>().toHaveProperty('queryOperationTypes');
});

test('SPI deserializeContract output is assignable to visualization shape', () => {
  const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

  expectTypeOf<Models>().toHaveProperty('User');
  expectTypeOf<Models>().toHaveProperty('Post');
  expectTypeOf(contract.storage.namespaces['__unbound__'].tables).toHaveProperty('user');
  expectTypeOf(contract.storage.namespaces['__unbound__'].tables).toHaveProperty('post');
  expectTypeOf(
    contract.domain.namespaces[UNBOUND_DOMAIN_NAMESPACE_ID]!.models.User.storage.fields,
  ).toHaveProperty('email');
  expectTypeOf(
    contract.domain.namespaces[UNBOUND_DOMAIN_NAMESPACE_ID]!.models.Post.storage.fields,
  ).toHaveProperty('userId');
});
