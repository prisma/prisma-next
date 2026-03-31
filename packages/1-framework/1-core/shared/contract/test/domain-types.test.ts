import { describe, expect, it } from 'vitest';
import type { DomainField, DomainModel, DomainRelation } from '../src/domain-types';
import type { ContractBase } from '../src/types';

describe('domain types', () => {
  it('ContractBase includes roots', () => {
    type Roots = ContractBase['roots'];

    const roots: Roots = { users: 'User' };
    expect(roots).toEqual({ users: 'User' });
  });

  it('DomainModel can represent SQL models', () => {
    const models: Record<string, DomainModel> = {
      User: {
        fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
        relations: {},
        storage: { table: 'user' },
      },
    };

    expect(models['User']?.fields['id']?.nullable).toBe(false);
  });

  it('DomainField carries nullable and codecId', () => {
    const field: DomainField = { nullable: true, codecId: 'pg/text@1' };
    expect(field.nullable).toBe(true);
    expect(field.codecId).toBe('pg/text@1');
  });

  it('DomainRelation supports reference strategy with on clause', () => {
    const relation: DomainRelation = {
      to: 'Post',
      cardinality: '1:N',
      strategy: 'reference',
      on: { localFields: ['id'], targetFields: ['userId'] },
    };
    expect(relation.to).toBe('Post');
    expect(relation.strategy).toBe('reference');
  });

  it('DomainRelation supports embed strategy without on clause', () => {
    const relation: DomainRelation = {
      to: 'Address',
      cardinality: '1:1',
      strategy: 'embed',
    };
    expect(relation.strategy).toBe('embed');
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
});
