import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import { OrmModelBuilderImpl } from './orm-builder';
import type { ExtractCodecTypes } from './types';
import type { OrmBuilderOptions, OrmRegistry } from './orm-types';

type ModelName<TContract extends SqlContract<SqlStorage>> = keyof TContract['models'] & string;

export function orm<TContract extends SqlContract<SqlStorage>>(
  options: OrmBuilderOptions<TContract>,
): OrmRegistry<TContract, ExtractCodecTypes<TContract>> {
  const contract = options.context.contract;
  type CodecTypes = ExtractCodecTypes<TContract>;

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
        new OrmModelBuilderImpl<TContract, CodecTypes, typeof modelName>(
          options,
          modelName,
        );
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
