import type { AnyMongoWireCommand, MongoContract } from '@prisma-next/mongo-core';
import {
  AggregateCommand,
  DeleteOneCommand,
  InsertOneCommand,
  MongoParamRef,
  UpdateOneCommand,
} from '@prisma-next/mongo-core';
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
    it('resolves param refs in filter and update', () => {
      const command = new UpdateOneCommand(
        'users',
        { _id: new MongoParamRef('id-123') },
        { $set: { name: new MongoParamRef('Charlie') } },
      );
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'updateOne');
      expect(wire.filter).toEqual({ _id: 'id-123' });
      expect(wire.update).toEqual({ $set: { name: 'Charlie' } });
    });
  });

  describe('lowerCommand DeleteOneCommand', () => {
    it('resolves param refs in filter', () => {
      const command = new DeleteOneCommand('users', {
        _id: new MongoParamRef('id-456'),
      });
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'deleteOne');
      expect(wire.filter).toEqual({ _id: 'id-456' });
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

  describe('nested values', () => {
    it('resolves deeply nested param refs', () => {
      const command = new InsertOneCommand('orders', {
        'shipping.address.city': new MongoParamRef('Sydney'),
        items: [{ sku: new MongoParamRef('ABC') }],
      });
      const wire = narrowWire(adapter.lowerCommand(command, stubContext), 'insertOne');
      expect(wire.document).toEqual({
        'shipping.address.city': 'Sydney',
        items: [{ sku: 'ABC' }],
      });
    });
  });
});
