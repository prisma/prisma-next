import { describe, expect, it } from 'vitest';
import { extractReplSchemaInfo } from '../../src/repl/schema-info';
import { replContractFixture } from './fixture';

describe('extractReplSchemaInfo', () => {
  const schema = extractReplSchemaInfo(replContractFixture);

  it('extracts namespaces', () => {
    expect(Object.keys(schema.namespaces)).toEqual(['public']);
  });

  it('extracts tables with columns in declaration order', () => {
    const tables = schema.namespaces['public']?.tables;
    expect(Object.keys(tables ?? {})).toEqual(['user', 'post']);
    expect(tables?.['user']?.columns.map((c) => c.name)).toEqual(['id', 'email', 'createdAt']);
  });

  it('extracts column native type and nullability', () => {
    const userId = schema.namespaces['public']?.tables['post']?.columns.find(
      (c) => c.name === 'userId',
    );
    expect(userId).toEqual({
      name: 'userId',
      nativeType: 'uuid',
      nullable: true,
      isPrimaryKey: false,
    });
  });

  it('marks primary key columns', () => {
    const id = schema.namespaces['public']?.tables['user']?.columns.find((c) => c.name === 'id');
    expect(id?.isPrimaryKey).toBe(true);
  });

  it('extracts models with fields, relations, and backing table', () => {
    const user = schema.namespaces['public']?.models['User'];
    expect(user?.fields).toEqual(['id', 'email', 'createdAt']);
    expect(user?.relations).toEqual(['posts']);
    expect(user?.table).toBe('user');
  });

  it('extracts enums with member names', () => {
    const enums = schema.namespaces['public']?.enums;
    expect(enums).toEqual({ Priority: ['Low', 'High'] });
  });

  it('returns empty schema for malformed input', () => {
    expect(extractReplSchemaInfo(null).namespaces).toEqual({});
    expect(extractReplSchemaInfo({}).namespaces).toEqual({});
    expect(extractReplSchemaInfo({ domain: 42 }).namespaces).toEqual({});
  });
});
