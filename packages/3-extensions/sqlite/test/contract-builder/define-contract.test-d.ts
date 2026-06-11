import type { ContractModelDefinitions } from '@prisma-next/contract/types';
import { expectTypeOf } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

// @ts-expect-error — capabilities are contributed by components, not authoring input
defineContract({ capabilities: { sql: { lateral: true } } });

const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'sqlite'>();
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
expectTypeOf(withModel.target).toEqualTypeOf<'sqlite'>();
expectTypeOf<ContractModelDefinitions<typeof withModel>['User']>().not.toBeNever();

const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.id.uuidv4String() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'sqlite'>();
expectTypeOf<ContractModelDefinitions<typeof withFactory>['Post']>().not.toBeNever();
