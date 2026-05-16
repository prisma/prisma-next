import { NamespaceBase } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from '../src/core/mongo-target-database';

describe('MongoTargetDatabase', () => {
  it('is a NamespaceBase subclass (target ↦ family ↦ framework lineage)', () => {
    const db = new MongoTargetDatabase('app_db');
    expect(db).toBeInstanceOf(NamespaceBase);
    expect(db).toBeInstanceOf(MongoTargetDatabase);
  });

  it('carries kind="database" and the database id', () => {
    const db = new MongoTargetDatabase('app_db');
    expect(db.kind).toBe('database');
    expect(db.id).toBe('app_db');
  });

  it('is frozen after construction (no mutation possible)', () => {
    const db = new MongoTargetDatabase('app_db');
    expect(Object.isFrozen(db)).toBe(true);
  });

  describe('qualifier emission', () => {
    it('returns the database name as its qualifier', () => {
      const db = new MongoTargetDatabase('analytics');
      expect(db.qualifier()).toBe('analytics');
    });

    it('qualifies a collection name with the database prefix', () => {
      const db = new MongoTargetDatabase('analytics');
      expect(db.qualifyCollection('events')).toBe('analytics.events');
    });
  });
});

describe('MongoTargetUnboundDatabase', () => {
  it('extends MongoTargetDatabase (target singleton ↦ target base ↦ framework)', () => {
    expect(MongoTargetUnboundDatabase.instance).toBeInstanceOf(MongoTargetDatabase);
    expect(MongoTargetUnboundDatabase.instance).toBeInstanceOf(MongoTargetUnboundDatabase);
    expect(MongoTargetUnboundDatabase.instance).toBeInstanceOf(NamespaceBase);
  });

  it('carries id="__unbound__"', () => {
    expect(MongoTargetUnboundDatabase.instance.id).toBe('__unbound__');
  });

  it('exposes a stable singleton reference', () => {
    expect(MongoTargetUnboundDatabase.instance).toBe(MongoTargetUnboundDatabase.instance);
  });

  it('elides the database prefix in qualifier emission (singleton-subclass polymorphism)', () => {
    expect(MongoTargetUnboundDatabase.instance.qualifier()).toBe('');
  });

  it('emits an unqualified collection name (no "<db>." prefix)', () => {
    expect(MongoTargetUnboundDatabase.instance.qualifyCollection('events')).toBe('events');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MongoTargetUnboundDatabase.instance)).toBe(true);
  });
});
