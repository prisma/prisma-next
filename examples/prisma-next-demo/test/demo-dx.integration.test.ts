/**
 * Demo DX integration tests.
 *
 * Verifies that contract visualization renders directly from the runtime contract
 * value (SPI deserializeContract output) with no type/runtime shape divergence.
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 */

import { storageNamespaceValues } from '@prisma-next/framework-components/ir';
import type { SqlNamespace } from '@prisma-next/sql-contract/types';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

describe('demo contract visualization DX', () => {
  it('validated contract has runtime shape needed for visualization', () => {
    const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

    expect(contract.target).toBeDefined();
    expect(typeof contract.target).toBe('string');
    expect(contract.storage.storageHash).toBeDefined();
    expect(contract.models).toBeDefined();
    expect(typeof contract.models).toBe('object');
    expect(contract.storage).toBeDefined();
    expect(contract.storage.__unbound__).toBeDefined();
    expect(contract.capabilities).toBeDefined();
    expect(typeof contract.capabilities).toBe('object');
    expect(contract.extensionPacks).toBeDefined();
    expect(typeof contract.extensionPacks).toBe('object');
  });

  it('validated contract exposes model storage field mappings', () => {
    const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

    expect(contract.models.User.storage.table).toBe('user');
    expect(contract.models.User.storage.fields.email.column).toBe('email');
    expect(contract.models.Post.storage.fields.userId.column).toBe('userId');
  });

  it('validated contract omits _generated at runtime', () => {
    const contractWithGenerated = {
      ...contractJson,
      _generated: { emittedAt: '2026-02-15T12:00:00Z' },
    };
    const contract = new PostgresContractSerializer().deserializeContract(
      contractWithGenerated,
    ) as Contract;

    expect(contract).not.toHaveProperty('_generated');
    expect(Object.hasOwn(contract as object, '_generated')).toBe(false);
  });

  it('validated contract is traversable for render use-case', () => {
    const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

    for (const [, model] of Object.entries(contract.models)) {
      const m = model as Record<string, unknown>;
      expect(m['storage']).toBeDefined();
      expect(m['fields']).toBeDefined();
      expect(m['relations']).toBeDefined();
      expect(typeof m['relations']).toBe('object');
    }

    for (const ns of storageNamespaceValues<SqlNamespace>(contract.storage)) {
      for (const [, table] of Object.entries(ns.tables)) {
        expect(table.columns).toBeDefined();
      }
    }
  });
});
