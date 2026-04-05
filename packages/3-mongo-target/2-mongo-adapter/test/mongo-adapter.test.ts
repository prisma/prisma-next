import type { AnyMongoCommand } from '@prisma-next/mongo-query-ast';
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
import { MongoParamRef } from '@prisma-next/mongo-value';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const stubMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo-orm',
  paramDescriptors: [],
};

function plan(collection: string, command: AnyMongoCommand) {
  return { collection, command, meta: stubMeta };
}

function narrowWire<K extends AnyMongoWireCommand['kind']>(
  wireCommand: AnyMongoWireCommand,
  kind: K,
): Extract<AnyMongoWireCommand, { kind: K }> {
  expect(wireCommand.kind).toBe(kind);
  return wireCommand as Extract<AnyMongoWireCommand, { kind: K }>;
}

describe('MongoAdapter', () => {
  const adapter = createMongoAdapter();

  describe('InsertOneCommand', () => {
    it('resolves param refs in document', () => {
      const command = new InsertOneCommand('users', {
        name: new MongoParamRef('Bob'),
        age: new MongoParamRef(25),
        active: true,
      });
      const wire = narrowWire(adapter.lower(plan('users', command)), 'insertOne');
      expect(wire.document).toEqual({ name: 'Bob', age: 25, active: true });
    });
  });

  describe('UpdateOneCommand', () => {
    it('resolves filter expression and update', () => {
      const command = new UpdateOneCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-123')),
        { $set: { name: new MongoParamRef('Charlie') } },
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'updateOne');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-123' } });
      expect(wire.update).toEqual({ $set: { name: 'Charlie' } });
    });
  });

  describe('DeleteOneCommand', () => {
    it('resolves filter expression', () => {
      const command = new DeleteOneCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-456')),
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'deleteOne');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-456' } });
    });
  });

  describe('AggregateCommand with raw pipeline', () => {
    it('passes raw pipeline through', () => {
      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ];
      const command = new AggregateCommand('users', pipeline);
      const wire = narrowWire(adapter.lower(plan('users', command)), 'aggregate');
      expect(wire.pipeline).toEqual(pipeline);
    });
  });

  describe('AggregateCommand with typed stages', () => {
    it('lowers typed stages to pipeline documents', () => {
      const stages = [
        new MongoMatchStage(MongoFieldFilter.eq('status', new MongoParamRef('active'))),
        new MongoProjectStage({ name: 1, email: 1 }),
      ];
      const command = new AggregateCommand('users', stages);
      const wire = narrowWire(adapter.lower(plan('users', command)), 'aggregate');
      expect(wire.pipeline).toEqual([
        { $match: { status: { $eq: 'active' } } },
        { $project: { name: 1, email: 1 } },
      ]);
    });

    it('returns empty pipeline for empty stages', () => {
      const command = new AggregateCommand('orders', []);
      const wire = narrowWire(adapter.lower(plan('orders', command)), 'aggregate');
      expect(wire.pipeline).toEqual([]);
    });
  });

  describe('InsertManyCommand', () => {
    it('resolves param refs in all documents', () => {
      const command = new InsertManyCommand('users', [
        { name: new MongoParamRef('Alice'), age: 30 },
        { name: new MongoParamRef('Bob'), age: 25 },
      ]);
      const wire = narrowWire(adapter.lower(plan('users', command)), 'insertMany');
      expect(wire.documents).toEqual([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
    });
  });

  describe('UpdateManyCommand', () => {
    it('resolves filter expression and update', () => {
      const command = new UpdateManyCommand(
        'users',
        MongoFieldFilter.eq('status', new MongoParamRef('inactive')),
        { $set: { status: new MongoParamRef('archived') } },
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'updateMany');
      expect(wire.filter).toEqual({ status: { $eq: 'inactive' } });
      expect(wire.update).toEqual({ $set: { status: 'archived' } });
    });
  });

  describe('DeleteManyCommand', () => {
    it('resolves filter expression', () => {
      const command = new DeleteManyCommand(
        'users',
        MongoFieldFilter.eq('status', new MongoParamRef('archived')),
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'deleteMany');
      expect(wire.filter).toEqual({ status: { $eq: 'archived' } });
    });
  });

  describe('FindOneAndUpdateCommand', () => {
    it('resolves filter and update with upsert false', () => {
      const command = new FindOneAndUpdateCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-789')),
        { $set: { name: new MongoParamRef('Updated') } },
        false,
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'findOneAndUpdate');
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
      const wire = narrowWire(adapter.lower(plan('users', command)), 'findOneAndUpdate');
      expect(wire.upsert).toBe(true);
    });
  });

  describe('FindOneAndDeleteCommand', () => {
    it('resolves filter expression', () => {
      const command = new FindOneAndDeleteCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('id-delete')),
      );
      const wire = narrowWire(adapter.lower(plan('users', command)), 'findOneAndDelete');
      expect(wire.filter).toEqual({ _id: { $eq: 'id-delete' } });
    });
  });

  describe('nested values', () => {
    it('resolves deeply nested param refs', () => {
      const command = new InsertOneCommand('orders', {
        shipping: { address: { city: new MongoParamRef('Sydney') } },
        items: [{ sku: new MongoParamRef('ABC') }],
      });
      const wire = narrowWire(adapter.lower(plan('orders', command)), 'insertOne');
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
      const wire = narrowWire(adapter.lower(plan('events', command)), 'insertOne');
      expect(wire.document['occurredAt']).toBe(now);
    });
  });
});
