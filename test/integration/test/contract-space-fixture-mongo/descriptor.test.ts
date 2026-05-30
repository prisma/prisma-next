import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { getStorageNamespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { MongoNamespaceShape } from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import {
  MONGO_TEST_BASELINE_INVARIANT_ID,
  MONGO_TEST_BASELINE_MIGRATION_NAME,
  MONGO_TEST_COLLECTION,
  MONGO_TEST_SPACE_ID,
} from './constants';
import { MONGO_TEST_HEAD_HASH } from './contract';
import mongoTestContractSpaceExtensionDescriptor from './control';

describe('test-mongo-contract-space fixture descriptor', () => {
  it('identifies as a Mongo extension targeted at mongo', () => {
    expect(mongoTestContractSpaceExtensionDescriptor).toMatchObject({
      kind: 'extension',
      id: MONGO_TEST_SPACE_ID,
      familyId: 'mongo',
      targetId: 'mongo',
    });
  });

  it('exposes a contractSpace whose contract declares the test_audit_event collection', () => {
    const space = mongoTestContractSpaceExtensionDescriptor.contractSpace;
    expect(space).toBeDefined();
    const ns = getStorageNamespace<MongoNamespaceShape>(
      space!.contractJson.storage,
      UNBOUND_NAMESPACE_ID,
    );
    expect(Object.keys(ns!.collections)).toEqual([MONGO_TEST_COLLECTION]);
  });

  it('declares one unique index and one strict validator on the test collection', () => {
    const ns = getStorageNamespace<MongoNamespaceShape>(
      mongoTestContractSpaceExtensionDescriptor.contractSpace!.contractJson.storage,
      UNBOUND_NAMESPACE_ID,
    );
    const collection = ns!.collections[MONGO_TEST_COLLECTION];
    expect(collection).toBeDefined();
    expect(collection!.indexes).toHaveLength(1);
    expect(collection!.indexes![0]).toMatchObject({ unique: true });
    expect(collection!.validator).toMatchObject({
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });

  it('publishes one baseline migration that establishes the head invariant', () => {
    const space = mongoTestContractSpaceExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(MONGO_TEST_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.providedInvariants).toEqual([MONGO_TEST_BASELINE_INVARIANT_ID]);
    const opIds = baseline.ops.map((op: MigrationPlanOperation) => op.invariantId);
    expect(opIds).toContain(MONGO_TEST_BASELINE_INVARIANT_ID);
  });

  it('points the head ref at the baseline-applied state', () => {
    const headRef = mongoTestContractSpaceExtensionDescriptor.contractSpace!.headRef;
    expect(headRef).toEqual({
      hash: MONGO_TEST_HEAD_HASH,
      invariants: [MONGO_TEST_BASELINE_INVARIANT_ID],
    });
  });
});
