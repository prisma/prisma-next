import { describe, expect, it } from 'vitest';
import { mongoListSchemaEntityNames, mongoProjectSchemaToMember } from '../src/core/schema-shape';

/**
 * The Mongo family owns the introspected-schema shape (the framework aggregate
 * verifier/planner is shape-free). The introspected `MongoSchemaIR` exposes
 * `collections` as an array of `{ name, ... }`.
 */
describe('mongoProjectSchemaToMember', () => {
  it('removes other-member collections from the array form', () => {
    const appColl = { name: 'users', indexes: [] };
    const extColl = { name: 'cipherstash_state', indexes: [] };
    const orphanColl = { name: 'legacy_audit', indexes: [] };
    const schema = { collections: [appColl, extColl, orphanColl] };

    const projected = mongoProjectSchemaToMember(schema, new Set(['cipherstash_state'])) as {
      readonly collections: ReadonlyArray<{ readonly name: string }>;
    };

    expect(projected.collections.map((c) => c.name).sort()).toEqual(['legacy_audit', 'users']);
    expect(projected.collections).not.toBe(schema.collections);
    expect(projected.collections.find((c) => c.name === 'users')).toBe(appColl);
    expect(projected.collections.find((c) => c.name === 'legacy_audit')).toBe(orphanColl);
  });

  it('preserves non-`collections` fields', () => {
    const schema = {
      collections: [{ name: 'app_users' }, { name: 'ext_owned' }],
      meta: { driverVersion: '6.0' },
    };
    const projected = mongoProjectSchemaToMember(schema, new Set(['ext_owned'])) as {
      readonly collections: ReadonlyArray<{ readonly name: string }>;
      readonly meta: unknown;
    };
    expect(projected.collections.map((c) => c.name)).toEqual(['app_users']);
    expect(projected.meta).toBe(schema.meta);
  });

  it('returns the schema verbatim when nothing is removed', () => {
    const schema = { collections: [{ name: 'users' }] };
    expect(mongoProjectSchemaToMember(schema, new Set(['nope']))).toBe(schema);
  });

  it('prunes a record form of collections too', () => {
    const schema = { collections: { users: {}, ext_owned: {} } };
    const projected = mongoProjectSchemaToMember(schema, new Set(['ext_owned'])) as {
      readonly collections: Record<string, unknown>;
    };
    expect(Object.keys(projected.collections)).toEqual(['users']);
  });

  it('returns non-object schemas verbatim', () => {
    expect(mongoProjectSchemaToMember(null, new Set(['x']))).toBe(null);
  });
});

describe('mongoListSchemaEntityNames', () => {
  it('lists collection names from the array form', () => {
    const schema = { collections: [{ name: 'a' }, { name: 'b' }] };
    expect([...mongoListSchemaEntityNames(schema)].sort()).toEqual(['a', 'b']);
  });

  it('lists collection names from the record form', () => {
    expect([...mongoListSchemaEntityNames({ collections: { a: {}, b: {} } })].sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns none for an unrecognised shape', () => {
    expect(mongoListSchemaEntityNames({ other: 'shape' })).toEqual([]);
    expect(mongoListSchemaEntityNames(null)).toEqual([]);
  });
});
