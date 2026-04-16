import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { interpretPslDocumentToMongoContract } from '@prisma-next/mongo-contract-psl';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import { describeWithMongoDB } from '../mongo/setup';

const mongoPsl = `
model User {
  id    ObjectId @id @map("_id")
  name  String
  email String
  homeAddress Address
  tags  String[]
}

type Address {
  street String
  city   String
  zip    String
}
`;

const sqlPsl = `
model User {
  id    Int    @id
  name  String
  email String
  homeAddress Address
}

type Address {
  street String
  city   String
  zip    String
}
`;

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
};

const postgresScalarTypeDescriptors = new Map([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['Boolean', { codecId: 'pg/bool@1', nativeType: 'bool' }],
  ['Json', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
]) as ReadonlyMap<string, { codecId: string; nativeType: string }>;

function interpretMongoPsl(schema: string) {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  return interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: new Map([
      ['String', 'mongo/string@1'],
      ['Int', 'mongo/int32@1'],
      ['Boolean', 'mongo/bool@1'],
      ['DateTime', 'mongo/date@1'],
      ['ObjectId', 'mongo/objectId@1'],
      ['Float', 'mongo/double@1'],
    ]),
  });
}

function interpretSqlPsl(schema: string) {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  return interpretPslDocumentToSqlContract({
    document,
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
  });
}

describeWithMongoDB('value objects: end-to-end Mongo', (ctx) => {
  it('PSL → interpret → validate → ORM create and read', async () => {
    const result = interpretMongoPsl(mongoPsl);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Interpretation failed: ${result.failure.summary}`);

    const contract = result.value;
    expect(contract.valueObjects).toBeDefined();
    expect(contract.valueObjects!['Address']).toBeDefined();

    const userFields = contract.models['User']!.fields as Record<string, ContractField>;
    expect(userFields['homeAddress']!.type.kind).toBe('valueObject');

    const validated = validateMongoContract(contract);

    const orm = mongoOrm({ contract: validated.contract, executor: ctx.runtime });
    const userCollection = orm['user']!;

    const created = await userCollection.create({
      name: 'Alice',
      email: 'alice@example.com',
      homeAddress: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      tags: ['admin', 'active'],
    });

    expect(created).toMatchObject({
      name: 'Alice',
      homeAddress: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      tags: ['admin', 'active'],
    });

    const users = await userCollection.all();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: 'Alice',
      homeAddress: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      tags: ['admin', 'active'],
    });
  });

  it('PSL → interpret → validate → ORM update replaces value object', async () => {
    const result = interpretMongoPsl(mongoPsl);
    if (!result.ok) throw new Error(`Interpretation failed: ${result.failure.summary}`);

    const validated = validateMongoContract(result.value);
    const orm = mongoOrm({ contract: validated.contract, executor: ctx.runtime });
    const userCollection = orm['user']!;

    await userCollection.create({
      name: 'Bob',
      email: 'bob@example.com',
      homeAddress: { street: '456 Oak Ave', city: 'Shelbyville', zip: '12345' },
      tags: [],
    });

    const { MongoFieldFilter } = await import('@prisma-next/mongo-query-ast/execution');
    const updated = await userCollection
      .where(MongoFieldFilter.eq('name', 'Bob'))
      .update({ homeAddress: { street: '789 Pine Rd', city: 'Capital City', zip: '99999' } });

    expect(updated).toMatchObject({
      name: 'Bob',
      homeAddress: { street: '789 Pine Rd', city: 'Capital City', zip: '99999' },
    });
  });

  it('nullable value object field roundtrips null', async () => {
    const schema = `
model User {
  id      ObjectId @id @map("_id")
  name    String
  address Address?
}

type Address {
  street String
  city   String
}
`;
    const result = interpretMongoPsl(schema);
    if (!result.ok) throw new Error(`Interpretation failed: ${result.failure.summary}`);

    const validated = validateMongoContract(result.value);
    const orm = mongoOrm({ contract: validated.contract, executor: ctx.runtime });
    const userCollection = orm['user']!;

    await userCollection.create({ name: 'NoAddr', address: null });
    const users = await userCollection.all();
    expect(users).toHaveLength(1);
    expect(users[0]!['address']).toBeNull();
  });
});

describe('value objects: end-to-end SQL pipeline', () => {
  it('PSL → interpret produces contract with valueObjects and JSONB storage', () => {
    const result = interpretSqlPsl(sqlPsl);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Interpretation failed: ${result.failure.summary}`);

    const contract = result.value;
    expect(contract.valueObjects).toBeDefined();
    expect(contract.valueObjects!['Address']).toBeDefined();

    const addressVo = contract.valueObjects!['Address'] as ContractValueObject;
    const voFields = addressVo.fields;
    expect(voFields['street']).toBeDefined();
    expect(voFields['city']).toBeDefined();
    expect(voFields['zip']).toBeDefined();

    const userFields = contract.models['User']!.fields as Record<string, ContractField>;
    const homeAddressField = userFields['homeAddress']!;
    expect(homeAddressField.type).toEqual({ kind: 'valueObject', name: 'Address' });
    expect(homeAddressField.nullable).toBe(false);

    // SqlStorage type doesn't structurally overlap with this shape; use double-cast for test assertion
    const storage = contract.storage as unknown as {
      tables: Record<string, { columns: Record<string, { nativeType: string }> }>;
    };
    expect(storage.tables['user']).toBeDefined();
    expect(storage.tables['user']!.columns['homeAddress']).toBeDefined();
    expect(storage.tables['user']!.columns['homeAddress']!.nativeType).toBe('jsonb');
  });
});

describe('value objects: cross-family consistency', () => {
  it('both interpreters produce matching valueObjects definitions', () => {
    const mongoResult = interpretMongoPsl(`
model Item {
  id   ObjectId @id @map("_id")
  meta Metadata
}

type Metadata {
  label String
  count Int
}
`);
    const sqlResult = interpretSqlPsl(`
model Item {
  id   Int @id
  meta Metadata
}

type Metadata {
  label String
  count Int
}
`);

    expect(mongoResult.ok).toBe(true);
    expect(sqlResult.ok).toBe(true);
    if (!mongoResult.ok || !sqlResult.ok) return;

    const mongoVos = mongoResult.value.valueObjects!;
    const sqlVos = sqlResult.value.valueObjects!;

    expect(Object.keys(mongoVos)).toEqual(Object.keys(sqlVos));

    const mongoMetaFields = mongoVos['Metadata']!.fields;
    const sqlMetaFields = sqlVos['Metadata']!.fields;
    expect(Object.keys(mongoMetaFields)).toEqual(Object.keys(sqlMetaFields));

    for (const fieldName of Object.keys(mongoMetaFields)) {
      const mongoField = mongoMetaFields[fieldName] as ContractField;
      const sqlField = sqlMetaFields[fieldName] as ContractField;
      expect(mongoField.type.kind).toBe(sqlField.type.kind);
      expect(mongoField.nullable).toBe(sqlField.nullable);
    }

    const mongoItemFields = mongoResult.value.models['Item']!.fields as Record<
      string,
      ContractField
    >;
    const sqlItemFields = sqlResult.value.models['Item']!.fields as Record<string, ContractField>;

    expect(mongoItemFields['meta']!.type).toEqual({ kind: 'valueObject', name: 'Metadata' });
    expect(sqlItemFields['meta']!.type).toEqual({ kind: 'valueObject', name: 'Metadata' });
  });

  it('nested value objects produce consistent definitions across families', () => {
    const mongoResult = interpretMongoPsl(`
model Order {
  id   ObjectId @id @map("_id")
  ship ShippingInfo
}

type ShippingInfo {
  address Address
  notes   String
}

type Address {
  street String
  city   String
}
`);
    const sqlResult = interpretSqlPsl(`
model Order {
  id   Int @id
  ship ShippingInfo
}

type ShippingInfo {
  address Address
  notes   String
}

type Address {
  street String
  city   String
}
`);

    expect(mongoResult.ok).toBe(true);
    expect(sqlResult.ok).toBe(true);
    if (!mongoResult.ok || !sqlResult.ok) return;

    expect(Object.keys(mongoResult.value.valueObjects!).sort()).toEqual(
      Object.keys(sqlResult.value.valueObjects!).sort(),
    );

    const mongoShipping = mongoResult.value.valueObjects!['ShippingInfo']!.fields as Record<
      string,
      ContractField
    >;
    const sqlShipping = sqlResult.value.valueObjects!['ShippingInfo']!.fields as Record<
      string,
      ContractField
    >;

    expect(mongoShipping['address']!.type).toEqual({ kind: 'valueObject', name: 'Address' });
    expect(sqlShipping['address']!.type).toEqual({ kind: 'valueObject', name: 'Address' });
  });
});
