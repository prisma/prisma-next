import type { DocumentContract, PlanMeta } from '@prisma-next/contract/types';
import type { AnyMongoCommand, AnyMongoWireCommand, MongoQueryPlan } from '@prisma-next/mongo-core';
import {
  AggregateCommand,
  DeleteOneCommand,
  FindCommand,
  InsertOneCommand,
  MongoParamRef,
  UpdateOneCommand,
} from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
  paramDescriptors: [],
};

const stubContext = { contract: {} as DocumentContract };

function plan(command: AnyMongoCommand): MongoQueryPlan {
  return { command, meta: stubMeta };
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

  describe('lower FindCommand', () => {
    it('lowers a simple filter with param refs', () => {
      const command = new FindCommand('users', {
        name: new MongoParamRef('Alice'),
        age: new MongoParamRef(30, { name: 'age' }),
      });
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'find');

      expect(wire.collection).toBe('users');
      expect(wire.filter).toEqual({ name: 'Alice', age: 30 });
    });

    it('preserves projection and sort', () => {
      const command = new FindCommand(
        'users',
        { status: new MongoParamRef('active') },
        { projection: { name: 1, email: 1 }, sort: { name: 1 }, limit: 10, skip: 5 },
      );
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'find');

      expect(wire.projection).toEqual({ name: 1, email: 1 });
      expect(wire.sort).toEqual({ name: 1 });
      expect(wire.limit).toBe(10);
      expect(wire.skip).toBe(5);
    });

    it('handles empty filter', () => {
      const command = new FindCommand('users');
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'find');

      expect(wire.filter).toBeUndefined();
    });

    it('retains the original command for debugging', () => {
      const command = new FindCommand('users', { x: new MongoParamRef(1) });
      const result = adapter.lower(plan(command), stubContext);

      expect(result.command).toBe(command);
      expect(result.meta).toBe(stubMeta);
    });
  });

  describe('lower InsertOneCommand', () => {
    it('resolves param refs in document', () => {
      const command = new InsertOneCommand('users', {
        name: new MongoParamRef('Bob'),
        age: new MongoParamRef(25),
        active: true,
      });
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'insertOne');

      expect(wire.document).toEqual({ name: 'Bob', age: 25, active: true });
    });
  });

  describe('lower UpdateOneCommand', () => {
    it('resolves param refs in filter and update', () => {
      const command = new UpdateOneCommand(
        'users',
        { _id: new MongoParamRef('id-123') },
        { $set: { name: new MongoParamRef('Charlie') } },
      );
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'updateOne');

      expect(wire.filter).toEqual({ _id: 'id-123' });
      expect(wire.update).toEqual({ $set: { name: 'Charlie' } });
    });
  });

  describe('lower DeleteOneCommand', () => {
    it('resolves param refs in filter', () => {
      const command = new DeleteOneCommand('users', {
        _id: new MongoParamRef('id-456'),
      });
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'deleteOne');

      expect(wire.filter).toEqual({ _id: 'id-456' });
    });
  });

  describe('lower AggregateCommand', () => {
    it('passes pipeline through', () => {
      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ];
      const command = new AggregateCommand('users', pipeline);
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'aggregate');

      expect(wire.pipeline).toEqual(pipeline);
    });
  });

  describe('nested values', () => {
    it('resolves deeply nested param refs', () => {
      const command = new FindCommand('orders', {
        'shipping.address.city': new MongoParamRef('Sydney'),
        $or: [{ status: new MongoParamRef('shipped') }, { status: new MongoParamRef('delivered') }],
      });
      const result = adapter.lower(plan(command), stubContext);
      const wire = narrowWire(result.wireCommand, 'find');

      expect(wire.filter).toEqual({
        'shipping.address.city': 'Sydney',
        $or: [{ status: 'shipped' }, { status: 'delivered' }],
      });
    });
  });
});
