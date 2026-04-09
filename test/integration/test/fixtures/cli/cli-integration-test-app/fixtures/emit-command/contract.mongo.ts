import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, model, rel } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    email: field.string(),
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
    assigneeId: field.objectId(),
  },
  relations: {
    assignee: rel.belongsTo(User, {
      from: 'assigneeId',
      to: User.ref('_id'),
    }),
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

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  models: {
    Task,
    Bug,
    User,
    Comment,
  },
});
