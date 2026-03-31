/**
 * Demo DX integration tests.
 *
 * Verifies that contract visualization renders directly from the runtime contract
 * value (validateContract output) with no type/runtime shape divergence.
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 */
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

describe('demo contract visualization DX', () => {
  it('validated contract has runtime shape needed for visualization', () => {
    const contract = validateContract<Contract>(contractJson);

    expect(contract.target).toBeDefined();
    expect(typeof contract.target).toBe('string');
    expect(contract.storageHash).toBeDefined();
    expect(contract.models).toBeDefined();
    expect(typeof contract.models).toBe('object');
    expect(contract.storage).toBeDefined();
    expect(contract.storage.tables).toBeDefined();
    expect(contract.relations).toBeDefined();
    expect(typeof contract.relations).toBe('object');
    expect(contract.capabilities).toBeDefined();
    expect(typeof contract.capabilities).toBe('object');
    expect(contract.extensionPacks).toBeDefined();
    expect(typeof contract.extensionPacks).toBe('object');
  });

  it('validated contract has runtime-real mappings, no type-only keys', () => {
    const contract = validateContract<Contract>(contractJson);

    expect(contract.mappings).toBeDefined();
    expect(contract.mappings.modelToTable).toBeDefined();
    expect(contract.mappings.tableToModel).toBeDefined();
    expect(contract.mappings.fieldToColumn).toBeDefined();
    expect(contract.mappings.columnToField).toBeDefined();

    const mappingKeys = Object.keys(contract.mappings);
    expect(mappingKeys).not.toContain('codecTypes');
    expect(mappingKeys).not.toContain('operationTypes');
  });

  it('validated contract omits _generated at runtime', () => {
    const contractWithGenerated = {
      ...contractJson,
      _generated: { emittedAt: '2026-02-15T12:00:00Z' },
    };
    const contract = validateContract<Contract>(contractWithGenerated);

    expect(contract).not.toHaveProperty('_generated');
    expect(Object.hasOwn(contract as object, '_generated')).toBe(false);
  });

  it('validated contract is traversable for render use-case', () => {
    const contract = validateContract<Contract>(contractJson);

    for (const [, model] of Object.entries(contract.models)) {
      expect(model.storage).toBeDefined();
      expect(model.storage.table).toBeDefined();
      expect(model.fields).toBeDefined();
      const tableRelations = contract.relations[model.storage.table] ?? {};
      expect(typeof tableRelations).toBe('object');
    }

    for (const [, table] of Object.entries(contract.storage.tables)) {
      expect(table.columns).toBeDefined();
      expect(table.primaryKey).toBeDefined();
      expect(Array.isArray(table.primaryKey?.columns)).toBe(true);
    }
  });
});
