import { describe, expect, it } from 'vitest';
import type {
  DomainEmbedRelation,
  DomainField,
  DomainModel,
  DomainReferenceRelation,
  DomainRelation,
} from '../src/domain-types';
import type { ContractBase } from '../src/types';

type AssertExtends<T, U> = T extends U ? true : never;

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

  it('DomainReferenceRelation requires on and allows all cardinalities', () => {
    const relation: DomainReferenceRelation = {
      to: 'Post',
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['userId'] },
    };
    expect(relation.to).toBe('Post');
    expect(relation.on.localFields).toEqual(['id']);

    const _extendsRelation: AssertExtends<DomainReferenceRelation, DomainRelation> = true;
    expect(_extendsRelation).toBe(true);
  });

  it('DomainEmbedRelation has no on and excludes N:1 cardinality', () => {
    const relation: DomainEmbedRelation = {
      to: 'Address',
      cardinality: '1:N',
    };
    expect(relation.to).toBe('Address');
    expect('on' in relation).toBe(false);

    const _extendsRelation: AssertExtends<DomainEmbedRelation, DomainRelation> = true;
    expect(_extendsRelation).toBe(true);

    // N:1 is reference-only — not assignable to DomainEmbedRelation
    const _n1NotEmbed: AssertExtends<{ to: string; cardinality: 'N:1' }, DomainEmbedRelation> =
      // @ts-expect-error — N:1 is not assignable to '1:1' | '1:N'
      true;
    expect(_n1NotEmbed).toBe(true);
  });

  it('DomainRelation is a union of reference and embed', () => {
    const ref: DomainRelation = {
      to: 'Post',
      cardinality: 'N:1',
      on: { localFields: ['postId'], targetFields: ['id'] },
    };
    const embed: DomainRelation = {
      to: 'Address',
      cardinality: '1:1',
    };
    expect(ref.to).toBe('Post');
    expect(embed.to).toBe('Address');
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
