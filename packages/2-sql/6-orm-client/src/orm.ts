import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { Repository } from './repository';
import type { RepositoryContext, RepositoryModelName, RuntimeQueryable } from './types';

export interface OrmOptions<
  TContract extends SqlContract<SqlStorage>,
  Repos extends Partial<Record<string, Repository<TContract, RepositoryModelName<TContract>>>>,
> {
  readonly contract: TContract;
  readonly runtime: RuntimeQueryable;
  readonly repositories?: Repos;
}

type ModelNames<TContract extends SqlContract<SqlStorage>> = RepositoryModelName<TContract>;

type LowercaseFirst<Name extends string> = Name extends `${infer Head}${infer Tail}`
  ? `${Lowercase<Head>}${Tail}`
  : Name;

type ModelAliasKeys<Name extends string> = Name | LowercaseFirst<Name> | `${LowercaseFirst<Name>}s`;

type ModelRepositoryMap<TContract extends SqlContract<SqlStorage>> = {
  [K in ModelNames<TContract> as ModelAliasKeys<K>]: Repository<TContract, K>;
};

type OrmClient<
  TContract extends SqlContract<SqlStorage>,
  Repos extends Partial<Record<string, Repository<TContract, RepositoryModelName<TContract>>>>,
> = ModelRepositoryMap<TContract> & Repos;

export function orm<
  TContract extends SqlContract<SqlStorage>,
  Repos extends Partial<Record<string, Repository<TContract, ModelNames<TContract>>>> = Record<
    never,
    never
  >,
>(options: OrmOptions<TContract, Repos>): OrmClient<TContract, Repos> {
  const { contract, runtime, repositories } = options;
  const ctx: RepositoryContext<TContract> = { contract, runtime };
  const cache = new Map<string, Repository<TContract, ModelNames<TContract>>>();
  const modelAliases = createModelAliases(contract);

  return new Proxy({} as OrmClient<TContract, Repos>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      // Check custom repositories first
      if (repositories && Object.hasOwn(repositories, prop)) {
        return repositories[prop as keyof Repos];
      }

      // Check cache
      const cached = cache.get(prop);
      if (cached) {
        return cached;
      }

      // Resolve model name from plural key
      const modelName = resolveModelName(prop, modelAliases);
      if (!modelName) {
        throw new Error(
          `No model found for '${prop}'. Available models: ${Object.keys(contract.models as Record<string, unknown>).join(', ')}`,
        );
      }

      const repo = new Repository(ctx, modelName as ModelNames<TContract>);
      cache.set(prop, repo);
      return repo;
    },
  });
}

function createModelAliases<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): Map<string, ModelNames<TContract>> {
  const aliases = new Map<string, ModelNames<TContract>>();
  const modelNames = Object.keys(
    contract.models as Record<string, unknown>,
  ) as ModelNames<TContract>[];
  const modelToTable = contract.mappings.modelToTable ?? {};

  for (const modelName of modelNames) {
    const lowerModel = lowercaseFirst(modelName);

    aliases.set(modelName, modelName);
    aliases.set(lowerModel, modelName);
    aliases.set(`${lowerModel}s`, modelName);

    const tableName = modelToTable[modelName];
    if (tableName) {
      aliases.set(tableName, modelName);
      aliases.set(`${tableName}s`, modelName);
    }
  }

  return aliases;
}

function resolveModelName<ModelName extends string>(
  key: string,
  aliases: Map<string, ModelName>,
): ModelName | undefined {
  const exact = aliases.get(key);
  if (exact) {
    return exact;
  }

  if (key.endsWith('s')) {
    return aliases.get(key.slice(0, -1));
  }

  return undefined;
}

function lowercaseFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}
