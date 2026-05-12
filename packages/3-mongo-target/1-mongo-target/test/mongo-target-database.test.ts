import { NamespaceBase } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  MongoTargetDatabase,
  MongoTargetUnspecifiedDatabase,
} from '../src/core/mongo-target-database';

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

describe('MongoTargetUnspecifiedDatabase', () => {
  it('extends MongoTargetDatabase (target singleton ↦ target base ↦ framework)', () => {
    expect(MongoTargetUnspecifiedDatabase.instance).toBeInstanceOf(MongoTargetDatabase);
    expect(MongoTargetUnspecifiedDatabase.instance).toBeInstanceOf(MongoTargetUnspecifiedDatabase);
    expect(MongoTargetUnspecifiedDatabase.instance).toBeInstanceOf(NamespaceBase);
  });

  it('carries id="__unspecified__"', () => {
    expect(MongoTargetUnspecifiedDatabase.instance.id).toBe('__unspecified__');
  });

  it('exposes a stable singleton reference', () => {
    expect(MongoTargetUnspecifiedDatabase.instance).toBe(MongoTargetUnspecifiedDatabase.instance);
  });

  it('elides the database prefix in qualifier emission (singleton-subclass polymorphism)', () => {
    expect(MongoTargetUnspecifiedDatabase.instance.qualifier()).toBe('');
  });

  it('emits an unqualified collection name (no "<db>." prefix)', () => {
    expect(MongoTargetUnspecifiedDatabase.instance.qualifyCollection('events')).toBe('events');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MongoTargetUnspecifiedDatabase.instance)).toBe(true);
  });
});
