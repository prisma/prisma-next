import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, model, rel } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    name: field.string(),
    email: field.string(),
    bio: field.string().optional(),
  },
  relations: {
    posts: rel.hasMany('Post', { from: '_id', to: 'authorId' }),
  },
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    _id: field.objectId(),
    authorId: field.objectId(),
    title: field.string(),
    publishedAt: field.date().optional(),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id') }),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  models: {
    User,
    Post,
  },
});
