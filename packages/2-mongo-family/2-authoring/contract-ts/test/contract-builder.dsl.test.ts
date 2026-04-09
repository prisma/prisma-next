import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel, valueObject } from '../src/contract-builder';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

describe('mongo contract builder', () => {
  it('builds a canonical contract for referenced models', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
    });

    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        authorId: field.objectId(),
        title: field.string(),
      },
      relations: {
        author: rel.belongsTo(User, {
          from: 'authorId',
          to: User.ref('_id'),
        }),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Post },
    });

    expect(contract.targetFamily).toBe('mongo');
    expect(contract.target).toBe('mongo');
    expect(contract.roots).toEqual({
      users: 'User',
      posts: 'Post',
    });
    expect(contract.storage.collections).toEqual({
      users: {},
      posts: {},
    });
    expect(contract.models.Post).toEqual({
      storage: {
        collection: 'posts',
      },
      fields: {
        _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
        authorId: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
        title: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
      },
      relations: {
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            localFields: ['authorId'],
            targetFields: ['_id'],
          },
        },
      },
    });
    expect(contract.profileHash).toMatch(/^sha256:/);
    expect(contract.storage.storageHash).toMatch(/^sha256:/);
  });

  it('supports owned models, polymorphism, and value objects', () => {
    const Address = valueObject('Address', {
      fields: {
        street: field.string(),
        zip: field.string().optional(),
      },
    });

    const Task = model('Task', {
      collection: 'tasks',
      storageRelations: {
        comments: { field: 'comments' },
      },
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
        metadata: field.valueObject(Address).optional(),
      },
      relations: {
        comments: rel.hasMany('Comment'),
      },
      discriminator: {
        field: 'type',
        variants: {
          Bug: { value: 'bug' },
        },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
    });

    const Comment = model('Comment', {
      owner: Task,
      fields: {
        _id: field.objectId(),
        text: field.string(),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug, Comment },
      valueObjects: { Address },
    });

    expect(contract.roots).toEqual({
      tasks: 'Task',
    });
    expect(contract.storage.collections).toEqual({
      tasks: {},
    });
    expect(contract.valueObjects).toEqual({
      Address: {
        fields: {
          street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
          zip: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: true },
        },
      },
    });
    expect(contract.models.Task.storage).toEqual({
      collection: 'tasks',
      relations: {
        comments: { field: 'comments' },
      },
    });
    expect(contract.models.Task.discriminator).toEqual({ field: 'type' });
    expect(contract.models.Task.variants).toEqual({
      Bug: { value: 'bug' },
    });
    expect(contract.models.Bug.base).toBe('Task');
    expect(contract.models.Comment.owner).toBe('Task');
  });

  it('supports the callback authoring form', () => {
    const contract = defineContract(
      {
        family: mongoFamilyPack,
        target: mongoTargetPack,
      },
      ({ field, model, rel, valueObject }) => {
        const Address = valueObject('Address', {
          fields: {
            street: field.string(),
          },
        });

        const User = model('User', {
          collection: 'users',
          fields: {
            _id: field.objectId(),
            address: field.valueObject(Address).optional(),
          },
        });

        const Post = model('Post', {
          collection: 'posts',
          fields: {
            _id: field.objectId(),
            authorId: field.objectId(),
          },
          relations: {
            author: rel.belongsTo(User, {
              from: 'authorId',
              to: User.ref('_id'),
            }),
          },
        });

        return {
          valueObjects: { Address },
          models: { User, Post },
        };
      },
    );

    expect(contract.models.User.fields.address).toEqual({
      type: { kind: 'valueObject', name: 'Address' },
      nullable: true,
    });
    expect(contract.models.Post.relations.author).toEqual({
      to: 'User',
      cardinality: 'N:1',
      on: {
        localFields: ['authorId'],
        targetFields: ['_id'],
      },
    });
  });
});
