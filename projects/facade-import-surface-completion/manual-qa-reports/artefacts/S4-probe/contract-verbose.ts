import mongoFamily from '@prisma-next/family-mongo/pack';
import { defineContract, field, model } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTarget from '@prisma-next/target-mongo/pack';

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  models: {
    Order: model('Order', {
      collection: 'orders',
      fields: {
        _id: field.objectId(),
        amount: field.double(),
        status: field.string(),
      },
    }),
  },
});
