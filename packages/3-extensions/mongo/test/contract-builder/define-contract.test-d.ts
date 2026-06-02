import type { ContractModelDefinitions } from '@prisma-next/contract/types';
import mongoFamilyPack from '@prisma-next/family-mongo/pack';
import mongoTargetPack from '@prisma-next/target-mongo/pack';
import { expectTypeOf } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

// @ts-expect-error — family is no longer accepted; the facade pre-binds it
defineContract({ family: mongoFamilyPack, extensionPacks: undefined });

// @ts-expect-error — target is no longer accepted; the facade pre-binds it
defineContract({ target: mongoTargetPack, extensionPacks: undefined });

// Literal target and targetFamily are preserved on the result
const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'mongo'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'mongo'>();

// Model-shape inference flows through the return type (definition form)
const withModel = defineContract({
  models: {
    User: model('User', { fields: { id: field.objectId() } }),
  },
});
expectTypeOf(withModel.target).toEqualTypeOf<'mongo'>();
expectTypeOf<ContractModelDefinitions<typeof withModel>['User']>().not.toBeNever();

// Model-shape inference flows through the return type (factory form)
const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.objectId() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'mongo'>();
expectTypeOf<ContractModelDefinitions<typeof withFactory>['Post']>().not.toBeNever();
