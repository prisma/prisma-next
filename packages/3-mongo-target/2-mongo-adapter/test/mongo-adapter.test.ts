import type { AnyMongoWireCommand, MongoContract } from '@prisma-next/mongo-core';
import { MongoParamRef } from '@prisma-next/mongo-core';
import {
  AggregateCommand,
  DeleteManyCommand,
  DeleteOneCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoFieldFilter,
  MongoMatchStage,
  MongoProjectStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const stubContext = { contract: {} as MongoContract };

function narrowWire<K extends AnyMongoWireCommand['kind']>(
  wireCommand: AnyMongoWireCommand,
  kind: K,
): Extract<AnyMongoWireCommand, { kind: K }> {
  expect(wireCommand.kind).toBe(kind);
  return wireCommand as Extract<AnyMongoWireCommand, { kind: K }>;
}

describe('MongoAdapter', () => {
  const adapter = createMongoAdapter();

  describe('lowerCommand InsertOneCommand', () => {
    it('resolves param refs in document', () => {
      const command = new InsertOneCommand('users', {
        name: new MongoParamRef('Bob'),
        age: new MongoParamRef(25),
        active: true,
      });
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'insertOne');
      expect(wire.document).toEqual({ name: 'Bob', age: 25, active: true });
    });
  });

  describe('lowerCommand UpdateOneCommand', () => {
    it('resolves filter expression and update', () => {
      const command = new UpdateOneCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-123')),
        { $set: { name: new MongoParamRef('Charlie') } },
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'updateOne');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-123' } });
      expect(wire.update).toEqual({ $set: { name: 'Charlie' } });
    });
  });

  describe('lowerCommand DeleteOneCommand', () => {
    it('resolves filter expression', () => {
      const command = new DeleteOneCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-456')),
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'deleteOne');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-456' } });
    });
  });

  describe('lowerCommand AggregateCommand', () => {
    it('passes pipeline through', () => {
      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ];
      const command = new AggregateCommand('users', pipeline);
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'aggregate');
      expect(wire.pipeline).toEqual(pipeline);
    });
  });

  describe('lowerCommand InsertManyCommand', () => {
    it('resolves param refs in all documents', () => {
      const command = new InsertManyCommand('users', [
        { name: new MongoParamRef('Alice'), age: 30 },
        { name: new MongoParamRef('Bob'), age: 25 },
      ]);
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'insertMany');
      expect(wire.documents).toEqual([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
    });
  });

  describe('lowerCommand UpdateManyCommand', () => {
    it('resolves filter expression and update', () => {
      const command = new UpdateManyCommand(
        'users',
        MongoFieldFilter.eq('status', new MongoParamRef('inactive')),
        { $set: { status: new MongoParamRef('archived') } },
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'updateMany');
      expect(wire.filter).toEqual({ status: { $eq: 'inactive' } });
      expect(wire.update).toEqual({ $set: { status: 'archived' } });
    });
  });

  describe('lowerCommand DeleteManyCommand', () => {
    it('resolves filter expression', () => {
      const command = new DeleteManyCommand(
        'users',
        MongoFieldFilter.eq('status', new MongoParamRef('archived')),
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'deleteMany');
      expect(wire.filter).toEqual({ status: { $eq: 'archived' } });
    });
  });

  describe('lowerCommand FindOneAndUpdateCommand', () => {
    it('resolves filter and update with upsert false', () => {
      const command = new FindOneAndUpdateCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-789')),
        { $set: { name: new MongoParamRef('Updated') } },
        false,
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'findOneAndUpdate');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-789' } });
      expect(wire.update).toEqual({ $set: { name: 'Updated' } });
      expect(wire.upsert).toBe(false);
    });

    it('preserves upsert true', () => {
      const command = new FindOneAndUpdateCommand(
        'users',
        MongoFieldFilter.eq('email', 'test@test.com'),
        { $set: { name: 'Upserted' }, $setOnInsert: { createdAt: 'now' } },
        true,
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'findOneAndUpdate');
      expect(wire.upsert).toBe(true);
    });

    it('uses empty filter when null', () => {
      const command = new FindOneAndUpdateCommand(
        'users',
        null,
        { $set: { name: 'Upserted' } },
        true,
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'findOneAndUpdate');
      expect(wire.filter).toEqual({});
    });
  });

  describe('lowerCommand FindOneAndDeleteCommand', () => {
    it('resolves filter expression', () => {
      const command = new FindOneAndDeleteCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-delete')),
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'findOneAndDelete');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-delete' } });
    });
  });

  describe('nested values', () => {
    it('resolves deeply nested param refs', () => {
      const command = new InsertOneCommand('orders', {
        shipping: { address: { city: new MongoParamRef('Sydney') } },
        items: [{ sku: new MongoParamRef('ABC') }],
      });
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'insertOne');
      expect(wire.document).toEqual({
        shipping: { address: { city: 'Sydney' } },
        items: [{ sku: 'ABC' }],
      });
    });

    it('preserves Date values as-is', () => {
      const now = new Date('2025-01-01T00:00:00Z');
      const command = new InsertOneCommand('events', {
        name: 'launch',
        occurredAt: now,
      });
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'insertOne');
      expect(wire.document['occurredAt']).toBe(now);
    });
  });

  describe('lowerReadPlan', () => {
    it('lowers a read plan with match and project stages', () => {
      const plan = {
        collection: 'users',
        stages: [
          new MongoMatchStage(MongoFieldFilter.eq('status', new MongoParamRef('active'))),
          new MongoProjectStage({ name: 1, email: 1 }),
        ],
        meta: {
          target: 'mongo',
          storageHash: 'test-hash',
          lane: 'mongo-orm',
          paramDescriptors: [],
        },
      };
      const wire = adapter.lowerReadPlan(plan);
      expect(wire.kind).toBe('aggregate');
      expect(wire.collection).toBe('users');
      expect(wire.pipeline).toEqual([
        { $match: { status: { $eq: 'active' } } },
        { $project: { name: 1, email: 1 } },
      ]);
    });

    it('returns an AggregateWireCommand for an empty pipeline', () => {
      const plan = {
        collection: 'orders',
        stages: [],
        meta: {
          target: 'mongo',
          storageHash: 'test-hash',
          lane: 'mongo-orm',
          paramDescriptors: [],
        },
      };
      const wire = adapter.lowerReadPlan(plan);
      expect(wire.kind).toBe('aggregate');
      expect(wire.collection).toBe('orders');
      expect(wire.pipeline).toEqual([]);
    });
  });
});
