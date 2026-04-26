import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { MongoOrmClient, MongoQueryPlan } from '@prisma-next/mongo-orm';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import type { MongoRuntime } from '@prisma-next/mongo-runtime';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';
import {
  type MongoBinding,
  type MongoBindingInput,
  resolveMongoBinding,
  resolveOptionalMongoBinding,
} from './binding';

export type MongoTargetId = 'mongo';

export interface MongoClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  readonly orm: MongoOrmClient<TContract>;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  readonly contract: TContract;
  connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime>;
  runtime(): Promise<MongoRuntime>;
  close(): Promise<void>;
}

export interface MongoOptionsBase {
  readonly mode?: 'strict' | 'permissive';
}

export interface MongoBindingOptions {
  readonly binding?: MongoBinding;
  readonly url?: string;
  readonly uri?: string;
  readonly dbName?: string;
  readonly mongoClient?: import('mongodb').MongoClient;
}

export type MongoOptionsWithContract<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = MongoBindingOptions &
  MongoOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

/**
 * `TContract` is a phantom parameter that drives explicit-type inference at the
 * call site (e.g. `mongo<Contract>({ contractJson })`). It is not referenced in
 * the type body — the contract value comes through `contractJson` at runtime.
 */
export type MongoOptionsWithContractJson<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = MongoBindingOptions &
  MongoOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    /**
     * @internal phantom field; never set at runtime, only references TContract
     * so that strict tsc/biome don't flag the type parameter as unused.
     */
    readonly __contractPhantom?: TContract;
  };

export type MongoOptions<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = MongoOptionsWithContract<TContract> | MongoOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>>(
  options: MongoOptions<TContract>,
): options is MongoOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>>(
  options: MongoOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return validateMongoContract<TContract>(contractInput).contract;
}

/**
 * Creates a lazy Mongo client from either `contractJson` or a TypeScript-authored `contract`.
 * The `orm` and `query` surfaces are available immediately; the underlying driver is connected
 * on the first query (or the first explicit `connect()` call), mirroring the Postgres facade.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: `mongo({ contract, url })`
 * - Emitted: pass `Contract` type explicitly. Example: `mongo<Contract>({ contractJson, url })`
 */
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: MongoOptionsWithContract<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: MongoOptionsWithContractJson<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: MongoOptions<TContract>): MongoClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalMongoBinding(options);

  const query = mongoQuery<TContract>({ contractJson: contract });

  let runtimePromise: Promise<MongoRuntime> | undefined;
  let runtimeForClose: MongoRuntime | undefined;
  let connected = false;

  const buildRuntime = async (resolvedBinding: MongoBinding): Promise<MongoRuntime> => {
    const adapter = createMongoAdapter();
    const driver =
      resolvedBinding.kind === 'url'
        ? await MongoDriverImpl.fromConnection(resolvedBinding.url, resolvedBinding.dbName)
        : MongoDriverImpl.fromDb(resolvedBinding.client.db(resolvedBinding.dbName));
    const runtime = createMongoRuntime({
      adapter,
      driver,
      contract,
      targetId: 'mongo',
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
    runtimeForClose = runtime;
    connected = true;
    return runtime;
  };

  const getRuntime = (): Promise<MongoRuntime> => {
    if (runtimePromise !== undefined) {
      return runtimePromise;
    }
    if (binding === undefined) {
      return Promise.reject(
        new Error(
          'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
        ),
      );
    }
    runtimePromise = buildRuntime(binding).catch((err) => {
      // Reset so a later connect()/runtime() can retry rather than always
      // re-throwing the cached failure.
      runtimePromise = undefined;
      throw err;
    });
    return runtimePromise;
  };

  const orm = mongoOrm<TContract>({
    contract,
    executor: {
      execute<Row>(plan: MongoQueryPlan<Row>) {
        async function* iterate(): AsyncGenerator<Row, void, unknown> {
          const runtime = await getRuntime();
          yield* runtime.execute(plan);
        }
        return new AsyncIterableResult(iterate());
      },
    },
  });

  return {
    orm,
    query,
    contract,

    async connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime> {
      if (connected || runtimePromise !== undefined) {
        throw new Error('Mongo client already connected');
      }
      if (bindingInput !== undefined) {
        binding = resolveMongoBinding(bindingInput);
      }
      if (binding === undefined) {
        throw new Error(
          'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
        );
      }
      return getRuntime();
    },

    runtime(): Promise<MongoRuntime> {
      return getRuntime();
    },

    async close(): Promise<void> {
      if (runtimeForClose !== undefined) {
        await runtimeForClose.close();
      }
    },
  };
}
