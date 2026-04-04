import { describe, expect, it } from 'vitest';
import type {
  ContractEmbedRelation,
  ContractField,
  ContractModel,
  ContractReferenceRelation,
  ContractRelation,
} from '../src/domain-types';

type AssertExtends<T, U> = T extends U ? true : never;

describe('contract types', () => {
  it('ContractField carries nullable and codecId', () => {
    const field: ContractField = { nullable: true, codecId: 'pg/text@1' };
    expect(field.nullable).toBe(true);
    expect(field.codecId).toBe('pg/text@1');
  });

  it('ContractReferenceRelation requires on and allows all cardinalities', () => {
    const relation: ContractReferenceRelation = {
      to: 'Post',
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['userId'] },
    };
    expect(relation.to).toBe('Post');
    expect(relation.on.localFields).toEqual(['id']);

    const _extendsRelation: AssertExtends<ContractReferenceRelation, ContractRelation> = true;
    expect(_extendsRelation).toBe(true);
  });

  it('ContractEmbedRelation has no on and excludes N:1 cardinality', () => {
    const relation: ContractEmbedRelation = {
      to: 'Address',
      cardinality: '1:N',
    };
    expect(relation.to).toBe('Address');
    expect('on' in relation).toBe(false);

    const _extendsRelation: AssertExtends<ContractEmbedRelation, ContractRelation> = true;
    expect(_extendsRelation).toBe(true);
  });

  it('ContractRelation is a union of reference and embed', () => {
    const ref: ContractRelation = {
      to: 'Post',
      cardinality: 'N:1',
      on: { localFields: ['postId'], targetFields: ['id'] },
    };
    const embed: ContractRelation = {
      to: 'Address',
      cardinality: '1:1',
    };
    expect(ref.to).toBe('Post');
    expect(embed.to).toBe('Address');
  });

  it('ContractModel supports polymorphism fields', () => {
    const model: ContractModel = {
      fields: { type: { nullable: false, codecId: 'pg/text@1' } },
      relations: {},
      storage: {},
      discriminator: { field: 'type' },
      variants: { Special: { value: 'special' } },
    };
    expect(model.discriminator?.field).toBe('type');
    expect(model.variants).toBeDefined();
  });

  it('ContractModel supports base for variant models', () => {
    const model: ContractModel = {
      fields: {},
      relations: {},
      storage: {},
      base: 'Parent',
    };
    expect(model.base).toBe('Parent');
  });

  it('ContractModel supports owner for component membership', () => {
    const model: ContractModel = {
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
