import { generateContractDts } from '@prisma-next/emitter';
import { mongoEmission } from '@prisma-next/mongo-emitter';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';

// ---------------------------------------------------------------------------
// Contract authoring — TS DSL
// ---------------------------------------------------------------------------

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

// Status has a different declaration order (C < A < B alphabetically) to prove
// ordinalOf() returns declaration order, not lexical order.
const Status = enumType(
  'Status',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('Pending', 'pending'),
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.objectId(),
    role: field.namedType(Role),
    mood: field.namedType(Role).optional(),
    tags: field.namedType(Role).many(),
  },
});

const contract = defineContract({
  enums: { Role, Status },
  models: { Account },
});

// ---------------------------------------------------------------------------
// Codec lookup for validator derivation
// ---------------------------------------------------------------------------

const BSON_TYPES: Record<string, string> = {
  'mongo/string@1': 'string',
  'mongo/objectId@1': 'objectId',
};

// Hand-derived $jsonSchema matching what deriveJsonSchema produces for Account.
// D3 unit tests prove deriveJsonSchema emits this exact shape; D5 proves the DB
// enforces it.
const ACCOUNT_JSON_SCHEMA = {
  bsonType: 'object',
  required: ['_id', 'role', 'tags'],
  properties: {
    _id: { bsonType: BSON_TYPES['mongo/objectId@1'] },
    role: { bsonType: BSON_TYPES['mongo/string@1'], enum: ['user', 'admin'] },
    mood: { bsonType: ['null', BSON_TYPES['mongo/string@1']!], enum: ['user', 'admin', null] },
    tags: {
      bsonType: 'array',
      items: { bsonType: BSON_TYPES['mongo/string@1'], enum: ['user', 'admin'] },
    },
  },
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// MMS harness
// ---------------------------------------------------------------------------

describe('mongo enum — end-to-end (replica set)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let nativeClient: MongoClient;
  let db: Db;
  const dbName = 'enum_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    nativeClient = new MongoClient(replSet.getUri());
    await nativeClient.connect();
    db = nativeClient.db(dbName);

    await db.createCollection('accounts', {
      validator: { $jsonSchema: ACCOUNT_JSON_SCHEMA },
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await nativeClient?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  // -------------------------------------------------------------------------
  // Part A: Author → Enforce (validator rejection / acceptance)
  // -------------------------------------------------------------------------

  describe('out-of-set scalar write is rejected', () => {
    it('rejects an insert with a role value not in the enum', async () => {
      await expect(
        db.collection('accounts').insertOne({ role: 'nope', tags: [] }),
      ).rejects.toThrow();
    });

    it('rejects an insert with a null value on a non-nullable field', async () => {
      await expect(db.collection('accounts').insertOne({ role: null, tags: [] })).rejects.toThrow();
    });
  });

  describe('in-set scalar write succeeds', () => {
    it('accepts a valid role value and round-trips it', async () => {
      const result = await db.collection('accounts').insertOne({ role: 'user', tags: [] });
      expect(result.acknowledged).toBe(true);

      const found = await db.collection('accounts').findOne({ _id: result.insertedId });
      expect(found?.['role']).toBe('user');
    });
  });

  describe('nullable scalar enum', () => {
    it('accepts null for a nullable enum field', async () => {
      const result = await db.collection('accounts').insertOne({
        role: 'admin',
        mood: null,
        tags: [],
      });
      expect(result.acknowledged).toBe(true);

      const found = await db.collection('accounts').findOne({ _id: result.insertedId });
      expect(found?.['mood']).toBeNull();
    });

    it('accepts an in-set value for a nullable enum field', async () => {
      await expect(
        db.collection('accounts').insertOne({ role: 'user', mood: 'admin', tags: [] }),
      ).resolves.toMatchObject({ acknowledged: true });
    });

    it('rejects an out-of-set value on a nullable enum field', async () => {
      await expect(
        db.collection('accounts').insertOne({ role: 'user', mood: 'bogus', tags: [] }),
      ).rejects.toThrow();
    });
  });

  describe('array enum field', () => {
    it('accepts an array of in-set values', async () => {
      const result = await db.collection('accounts').insertOne({
        role: 'user',
        tags: ['user', 'admin'],
      });
      expect(result.acknowledged).toBe(true);
    });

    it('accepts an empty array', async () => {
      const result = await db.collection('accounts').insertOne({ role: 'admin', tags: [] });
      expect(result.acknowledged).toBe(true);
    });

    it('rejects an array containing an out-of-set element', async () => {
      await expect(
        db.collection('accounts').insertOne({ role: 'user', tags: ['bogus'] }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Part A: Read — db.enums assertions via mongo() facade
  // -------------------------------------------------------------------------

  describe('db.enums via mongo() facade', () => {
    type AnyEnums = Record<
      string,
      {
        readonly values: readonly unknown[];
        readonly members: Record<string, unknown>;
        ordinalOf(v: unknown): number;
      }
    >;

    it('exposes the enum accessor at db.enums.Role without namespace key', () => {
      const db2 = mongo({ contract, uri: replSet.getUri(), dbName });
      const enums = db2.enums as unknown as AnyEnums;
      expect(enums['Role']).toBeDefined();
      expect(enums['Role']?.values).toEqual(['user', 'admin']);
    });

    it('db.enums.Role.values returns the ordered tuple', () => {
      const db2 = mongo({ contract, uri: replSet.getUri(), dbName });
      const enums = db2.enums as unknown as AnyEnums;
      expect(enums['Role']?.values).toEqual(['user', 'admin']);
    });

    it('db.enums.Role.members.User === "user"', () => {
      const db2 = mongo({ contract, uri: replSet.getUri(), dbName });
      const enums = db2.enums as unknown as AnyEnums;
      expect(enums['Role']?.members['User']).toBe('user');
    });

    it('db.enums.Status.ordinalOf returns declaration-order indices (not lexical)', () => {
      const db2 = mongo({ contract, uri: replSet.getUri(), dbName });
      const enums = db2.enums as unknown as AnyEnums;
      const status = enums['Status'];
      expect(status).toBeDefined();
      // Declaration order: Pending=0, Active=1, Inactive=2
      // Lexical order would be: Active=0, Inactive=1, Pending=2 — different.
      expect(status?.ordinalOf('pending')).toBe(0);
      expect(status?.ordinalOf('active')).toBe(1);
      expect(status?.ordinalOf('inactive')).toBe(2);
    });

    it('contract domain carries a scalar role field (compile-time)', () => {
      // Prove the contract type sees Account.role as a scalar field.
      // The no-emit InferFieldType path narrows it to the enum value union.
      type NS = (typeof contract)['domain']['namespaces'];
      type Fields = NS[keyof NS]['models']['Account']['fields'];
      type RoleKind = Fields['role']['type']['kind'];
      expectTypeOf<RoleKind>().toEqualTypeOf<'scalar'>();
    });
  });
});

// ---------------------------------------------------------------------------
// Part B: emit-then-consume type test (non-vacuous)
// ---------------------------------------------------------------------------

describe('emit-then-consume: value-union narrowing through the emitted contract.d.ts', () => {
  const mongoCodecImports = [
    {
      package: '@prisma-next/adapter-mongo/codec-types',
      named: 'CodecTypes' as const,
      alias: 'MongoCodecTypes' as const,
    },
  ];

  const testHashes = {
    storageHash: 'sha256:enum-e2e-test',
    profileHash: 'sha256:enum-e2e-profile',
  };

  it('emits the enum value union into FieldOutputTypes for a Role field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    // The enum field narrows to the literal value union (not the codec channel).
    expect(outputMap).toContain("readonly role: 'user' | 'admin'");
    expect(outputMap).not.toContain("readonly role: CodecTypes['mongo/string@1']['output']");

    // The non-enum fields are unchanged.
    expect(dts).toContain("CodecTypes['mongo/objectId@1']");
  });

  it('emits null-inclusive union for a nullable enum field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    expect(outputMap).toContain("readonly mood: 'user' | 'admin' | null");
  });

  it('emits ReadonlyArray value union for an array enum field', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
    );

    const outputMap = dts.slice(
      dts.indexOf('export type FieldOutputTypes'),
      dts.indexOf('export type FieldInputTypes'),
    );

    expect(outputMap).toContain("readonly tags: ReadonlyArray<'user' | 'admin'>");
  });

  it('non-vacuous: emits the enum domain block in the namespace type (contract.d.ts carries it)', () => {
    const dts = generateContractDts(
      contract as never,
      mongoEmission,
      mongoCodecImports,
      testHashes,
    );

    // The emitted contract.d.ts must carry the enum entity in the domain namespace
    // type so the consumer's type checker can resolve it. Without this block, the
    // FieldOutputTypes narrowing above would not fire.
    expect(dts).toContain('readonly enum:');
    expect(dts).toContain('readonly Role:');
    expect(dts).toContain("readonly codecId: 'mongo/string@1'");
    expect(dts).toContain("readonly name: 'User'");
    expect(dts).toContain("readonly value: 'user'");
    expect(dts).toContain("readonly name: 'Admin'");
    expect(dts).toContain("readonly value: 'admin'");
  });
});
