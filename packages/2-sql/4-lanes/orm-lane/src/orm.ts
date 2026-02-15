import { planInvalid } from '@prisma-next/plan';
import type {
  CodecTypesOf,
  ExtractCodecTypes,
  ExtractTypeMapsFromContract,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import { OrmModelBuilderImpl } from './orm/builder';
import type { OrmBuilderOptions, OrmRegistry } from './orm-types';

type ModelName<TContract extends SqlContract<SqlStorage>> = keyof TContract['models'] & string;

export function orm<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(
  options: OrmBuilderOptions<TContract>,
): OrmRegistry<
  TContract,
  [TTypeMaps] extends [never] ? ExtractCodecTypes<TContract> : CodecTypesOf<TTypeMaps>
> {
  const contract = options.context.contract;
  type CodecTypes = [TTypeMaps] extends [never]
    ? ExtractCodecTypes<TContract>
    : CodecTypesOf<TTypeMaps>;

  return new Proxy({} as OrmRegistry<TContract, CodecTypes>, {
    get(_target, prop) {
      if (typeof prop !== 'string') {
        return undefined;
      }

      const modelName = (prop.charAt(0).toUpperCase() + prop.slice(1)) as ModelName<TContract>;
      if (
        !contract.models ||
        typeof contract.models !== 'object' ||
        !(modelName in contract.models)
      ) {
        throw planInvalid(`Model ${prop} (resolved to ${modelName}) not found in contract`);
      }

      return () =>
        new OrmModelBuilderImpl<TContract, CodecTypes, typeof modelName>(options, modelName);
    },
    has(_target, prop) {
      if (typeof prop !== 'string') {
        return false;
      }
      const modelName = (prop.charAt(0).toUpperCase() + prop.slice(1)) as ModelName<TContract>;
      return contract.models && typeof contract.models === 'object' && modelName in contract.models;
    },
  });
}

// Re-export types for convenience
export type {
  ModelColumnAccessor,
  OrmBuilderOptions,
  OrmModelBuilder,
  OrmRegistry,
  OrmRelationAccessor,
  OrmRelationFilterBuilder,
  OrmWhereProperty,
} from './orm-types';
