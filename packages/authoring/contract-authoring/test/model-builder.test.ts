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
});
