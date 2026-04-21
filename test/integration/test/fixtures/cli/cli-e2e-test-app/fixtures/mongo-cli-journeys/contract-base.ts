import mongoFamily from '@prisma-next/family-mongo/pack';
import {
  defineContract,
  field,
  index,
  model,
} from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    email: field.string(),
    name: field.string(),
  },
  indexes: [index({ email: 1 }, { unique: true })],
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  models: { User },
});
