import { describe, expect, it } from 'vitest';
import type { DomainField, DomainModel, DomainRelation } from '../src/domain-types';
import type { ContractBase } from '../src/types';

describe('domain types', () => {
  it('ContractBase includes roots and models', () => {
    type Roots = ContractBase['roots'];
    type Models = ContractBase['models'];

    const roots: Roots = { users: 'User' };
    const models: Models = {
      User: {
        fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
        relations: {},
        storage: { table: 'user' },
      },
    };

    expect(roots).toEqual({ users: 'User' });
    expect(models['User']?.fields['id']?.nullable).toBe(false);
  });

  it('DomainField carries nullable and codecId', () => {
    const field: DomainField = { nullable: true, codecId: 'pg/text@1' };
    expect(field.nullable).toBe(true);
    expect(field.codecId).toBe('pg/text@1');
  });

  it('DomainRelation carries to, cardinality, and optional on', () => {
    const relation: DomainRelation = {
      to: 'Post',
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['userId'] },
    };
    expect(relation.to).toBe('Post');
    expect(relation.on?.localFields).toEqual(['id']);
  });

  it('DomainRelation without on clause (owned relation)', () => {
    const relation: DomainRelation = {
      to: 'Address',
      cardinality: '1:N',
    };
    expect(relation.to).toBe('Address');
    expect(relation.on).toBeUndefined();
  });

  it('DomainModel supports polymorphism fields', () => {
    const model: DomainModel = {
      fields: { type: { nullable: false, codecId: 'pg/text@1' } },
      relations: {},
      storage: {},
      discriminator: { field: 'type' },
      variants: { Special: { value: 'special' } },
    };
    expect(model.discriminator?.field).toBe('type');
    expect(model.variants).toBeDefined();
  });

  it('DomainModel supports base for variant models', () => {
    const model: DomainModel = {
      fields: {},
      relations: {},
      storage: {},
      base: 'Parent',
    };
    expect(model.base).toBe('Parent');
  });

  it('DomainModel supports owner for component membership', () => {
    const model: DomainModel = {
      fields: {
        street: { nullable: false, codecId: 'pg/text@1' },
      },
      relations: {},
      storage: {},
      owner: 'User',
    };
    expect(model.owner).toBe('User');
  });
});
