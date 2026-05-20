import sqlFamilyPack from '@prisma-next/family-sql/pack';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import { expectTypeOf } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

// family and target are no longer accepted — the facade pre-binds them
// @ts-expect-error — family is no longer accepted; the facade pre-binds it
defineContract({ family: sqlFamilyPack, extensionPacks: undefined });

// @ts-expect-error — target is no longer accepted; the facade pre-binds it
defineContract({ target: sqlitePack, extensionPacks: undefined });

// The returned contract carries literal 'sql' family-ID and 'sqlite' target-ID
const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'sqlite'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'sql'>();

// Model-shape inference flows through the return type (definition form)
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
// models carries the 'User' key — accessing it is defined (not never)
expectTypeOf(withModel.models.User).not.toBeNever();

// Model-shape inference flows through the return type (factory form)
const withFactory = defineContract({}, ({ model: m, field: f }) => ({
  models: {
    Post: m('Post', { fields: { id: f.id.uuidv4() } }),
  },
}));
expectTypeOf(withFactory.target).toEqualTypeOf<'sqlite'>();
expectTypeOf(withFactory.models.Post).not.toBeNever();
