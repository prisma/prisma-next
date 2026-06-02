import type { ContractModelDefinitions } from '@prisma-next/contract/types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';
import { expectTypeOf } from 'vitest';

// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { postgres: { lateral: true } } });

const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'postgres'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'sql'>();

const textColumn = {
  codecId: 'sql/char@1' as const,
  nativeType: 'character varying' as const,
  typeParams: {},
};
const withModel = defineContract({
  models: {
    User: model('User', { fields: { id: field.column(textColumn).id() } }),
  },
});
expectTypeOf(withModel.target).toEqualTypeOf<'postgres'>();
expectTypeOf<ContractModelDefinitions<typeof withModel>['User']>().not.toBeNever();

const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.id.uuidv4() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'postgres'>();
expectTypeOf<ContractModelDefinitions<typeof withFactory>['Post']>().not.toBeNever();
