/**
 * Per-class unit coverage for the Mongo class-flow IR:
 *
 * - Every `*Call` class constructs with literal args, is frozen, computes its
 *   label + operationClass, dispatches through `accept()` to the right
 *   visitor method, and emits the expected TypeScript expression + import
 *   requirements.
 * - Import requirements always reference `@prisma-next/target-mongo/migration`
 *   and the factory's own symbol — a regression guard against accidentally
 *   widening the import surface.
 * - Optional-args variants (`CreateIndexCall` with/without options,
 *   `CreateCollectionCall` with/without options, `CollModCall` with/without
 *   meta) omit the trailing argument when absent so rendered source stays
 *   minimal.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  type OpFactoryCallVisitor,
} from '../src/core/op-factory-call';

describe('Mongo call classes', () => {
  describe('construction + dispatch', () => {
    it('CreateIndexCall freezes, labels from collection + keys, and dispatches createIndex', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
      });

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('createIndex');
      expect(call.operationClass).toBe('additive');
      expect(call.label).toBe('Create index on users (email:1)');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.createIndex).toHaveBeenCalledWith(call);
    });

    it('DropIndexCall freezes, labels destructively, and dispatches dropIndex', () => {
      const call = new DropIndexCall('users', [{ field: 'legacy', direction: -1 }]);

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('dropIndex');
      expect(call.operationClass).toBe('destructive');
      expect(call.label).toBe('Drop index on users (legacy:-1)');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.dropIndex).toHaveBeenCalledWith(call);
    });

    it('CreateCollectionCall freezes, labels additively, and dispatches createCollection', () => {
      const call = new CreateCollectionCall('users');

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('createCollection');
      expect(call.operationClass).toBe('additive');
      expect(call.label).toBe('Create collection users');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.createCollection).toHaveBeenCalledWith(call);
    });

    it('DropCollectionCall freezes, labels destructively, and dispatches dropCollection', () => {
      const call = new DropCollectionCall('users');

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('dropCollection');
      expect(call.operationClass).toBe('destructive');
      expect(call.label).toBe('Drop collection users');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.dropCollection).toHaveBeenCalledWith(call);
    });

    it('CollModCall defaults operationClass to destructive and uses a default label', () => {
      const call = new CollModCall('users', { validator: { $jsonSchema: { type: 'object' } } });

      expect(Object.isFrozen(call)).toBe(true);
      expect(call.factoryName).toBe('collMod');
      expect(call.operationClass).toBe('destructive');
      expect(call.label).toBe('Modify collection users');

      const visitor = makeDispatchSpy();
      call.accept(visitor);
      expect(visitor.collMod).toHaveBeenCalledWith(call);
    });

    it('CollModCall honors caller-supplied meta.label and meta.operationClass', () => {
      const call = new CollModCall(
        'users',
        { validator: { $jsonSchema: { type: 'object' } } },
        { label: 'Tighten users validator', operationClass: 'widening' },
      );

      expect(call.operationClass).toBe('widening');
      expect(call.label).toBe('Tighten users validator');
    });
  });

  describe('renderTypeScript + importRequirements', () => {
    it('CreateIndexCall emits the factory call with options and imports createIndex only', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
      });

      expect(call.renderTypeScript()).toBe(
        'createIndex("users", [{ field: "email", direction: 1 }], { unique: true })',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'createIndex' },
      ]);
    });

    it('CreateIndexCall omits the trailing options argument when no options supplied', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }]);

      expect(call.renderTypeScript()).toBe(
        'createIndex("users", [{ field: "email", direction: 1 }])',
      );
    });

    it('DropIndexCall emits positional args and imports dropIndex only', () => {
      const call = new DropIndexCall('users', [{ field: 'legacy', direction: 1 }]);

      expect(call.renderTypeScript()).toBe(
        'dropIndex("users", [{ field: "legacy", direction: 1 }])',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'dropIndex' },
      ]);
    });

    it('CreateCollectionCall omits the trailing options argument when no options supplied', () => {
      const call = new CreateCollectionCall('users');

      expect(call.renderTypeScript()).toBe('createCollection("users")');
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'createCollection' },
      ]);
    });

    it('CreateCollectionCall emits the options argument when supplied', () => {
      const call = new CreateCollectionCall('sessions', { capped: true, size: 1024 });

      expect(call.renderTypeScript()).toBe(
        'createCollection("sessions", { capped: true, size: 1024 })',
      );
    });

    it('DropCollectionCall emits a single positional arg and imports dropCollection only', () => {
      const call = new DropCollectionCall('users');

      expect(call.renderTypeScript()).toBe('dropCollection("users")');
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'dropCollection' },
      ]);
    });

    it('CollModCall omits the trailing meta argument when no meta supplied', () => {
      const call = new CollModCall('users', { validator: { $jsonSchema: { type: 'object' } } });

      expect(call.renderTypeScript()).toBe(
        'collMod("users", { validator: { $jsonSchema: { type: "object" } } })',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@prisma-next/target-mongo/migration', symbol: 'collMod' },
      ]);
    });

    it('CollModCall emits the meta argument when supplied', () => {
      const call = new CollModCall(
        'users',
        { validator: { $jsonSchema: { type: 'object' } } },
        { label: 'Tighten', operationClass: 'widening' },
      );

      expect(call.renderTypeScript()).toBe(
        'collMod("users", { validator: { $jsonSchema: { type: "object" } } }, { label: "Tighten", operationClass: "widening" })',
      );
    });
  });
});

function makeDispatchSpy(): OpFactoryCallVisitor<void> {
  return {
    createIndex: vi.fn(),
    dropIndex: vi.fn(),
    createCollection: vi.fn(),
    dropCollection: vi.fn(),
    collMod: vi.fn(),
  };
}
