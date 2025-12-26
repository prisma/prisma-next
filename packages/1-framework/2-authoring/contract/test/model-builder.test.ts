import { describe, expect, it } from 'vitest';
import { ModelBuilder } from '../src/model-builder';

describe('ModelBuilder', () => {
  it('builds model state with fields', () => {
    const builder = new ModelBuilder('User', 'user');
    const model = builder.field('id', 'id').field('email', 'email').build();

    expect(model.name).toBe('User');
    expect(model.table).toBe('user');
    expect(model.fields).toEqual({
      id: 'id',
      email: 'email',
    });
  });

  it('builds model state with relations', () => {
    const builder = new ModelBuilder('User', 'user');
    const model = builder
      .field('id', 'id')
      .relation('posts', {
        toModel: 'Post',
        toTable: 'post',
        cardinality: '1:N',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'post',
          childColumns: ['userId'],
        },
      })
      .build();

    expect(model.relations.posts).toEqual({
      to: 'Post',
      cardinality: '1:N',
      on: {
        parentCols: ['id'],
        childCols: ['userId'],
      },
    });
  });

  it('validates relation parentTable matches model table', () => {
    const builder = new ModelBuilder('User', 'user');
    expect(() => {
      builder.relation('posts', {
        toModel: 'Post',
        toTable: 'post',
        cardinality: '1:N',
        on: {
          parentTable: 'wrong',
          parentColumns: ['id'],
          childTable: 'post',
          childColumns: ['userId'],
        },
      });
    }).toThrow('parentTable "wrong" does not match model table "user"');
  });

  it('builds model state with N:M relation', () => {
    const builder = new ModelBuilder('User', 'user');
    const model = builder
      .field('id', 'id')
      .relation('tags', {
        toModel: 'Tag',
        toTable: 'tag',
        cardinality: 'N:M',
        through: {
          table: 'user_tag',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
        },
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'user_tag',
          childColumns: ['userId'],
        },
      })
      .build();

    expect(model.relations.tags).toEqual({
      to: 'Tag',
      cardinality: 'N:M',
      on: {
        parentCols: ['id'],
        childCols: ['userId'],
      },
      through: {
        table: 'user_tag',
        parentCols: ['userId'],
        childCols: ['tagId'],
      },
    });
  });

  it('validates N:M relation requires through field', () => {
    const builder = new ModelBuilder('User', 'user');
    expect(() => {
      builder.relation('tags', {
        toModel: 'Tag',
        toTable: 'tag',
        cardinality: 'N:M',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'tag',
          childColumns: ['id'],
        },
        // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input that TypeScript would reject
      } as any);
    }).toThrow('Relation "tags" with cardinality "N:M" requires through field');
  });

  it('validates N:M relation childTable matches through.table', () => {
    const builder = new ModelBuilder('User', 'user');
    expect(() => {
      builder.relation('tags', {
        toModel: 'Tag',
        toTable: 'tag',
        cardinality: 'N:M',
        through: {
          table: 'user_tag',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
        },
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'wrong',
          childColumns: ['userId'],
        },
      });
    }).toThrow('Relation "tags" childTable "wrong" does not match through.table "user_tag"');
  });

  it('validates non-N:M relation childTable matches toTable', () => {
    const builder = new ModelBuilder('User', 'user');
    expect(() => {
      builder.relation('posts', {
        toModel: 'Post',
        toTable: 'post',
        cardinality: '1:N',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'wrong',
          childColumns: ['userId'],
        },
      });
    }).toThrow('Relation "posts" childTable "wrong" does not match toTable "post"');
  });
});
