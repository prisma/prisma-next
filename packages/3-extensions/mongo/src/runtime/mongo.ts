import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@prisma-next/mongo-contract';
import type { MongoOrmClient, MongoQueryPlan, MongoRawClient } from '@prisma-next/mongo-orm';
import { mongoOrm, mongoRaw } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import type { MongoMiddleware, MongoRuntime } from '@prisma-next/mongo-runtime';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
} from '@prisma-next/mongo-runtime';
import mongoRuntimeTarget from '@prisma-next/target-mongo/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type MongoBinding,
  type MongoBindingInput,
  resolveMongoBinding,
  resolveOptionalMongoBinding,
} from './binding';

export type MongoTargetId = typeof mongoRuntimeTarget.targetId;

type UnboundEnums<TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

function unboundNamespace<T>(builderOutput: { readonly [UNBOUND_NAMESPACE_ID]?: unknown }): T {
  return blindCast<T, 'the unbound namespace always exists on a mongo builder output'>(
    builderOutput[UNBOUND_NAMESPACE_ID],
  );
}

export interface MongoClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly orm: MongoOrmClient<TContract>;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  readonly raw: MongoRawClient<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime>;
  runtime(): Promise<MongoRuntime>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface MongoOptionsBase {
  readonly mode?: 'strict' | 'permissive';
  /**
   * Optional middleware chain applied to every Mongo execution.
   */
  readonly middleware?: readonly MongoMiddleware[];
}

export interface MongoBindingOptions {
  readonly binding?: MongoBinding;
  readonly url?: string;
  readonly uri?: string;
  readonly dbName?: string;
  readonly mongoClient?: import('mongodb').MongoClient;
}

export type MongoOptionsWithContract<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
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
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
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
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = MongoOptionsWithContract<TContract> | MongoOptionsWithContractJson<TContract>;

function hasContractJson<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): options is MongoOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return new MongoContractSerializer().deserializeContract(contractInput) as TContract;
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
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptionsWithContract<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptionsWithContractJson<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): MongoClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalMongoBinding(options);

  // `mongoQuery` calls its parameter `contractJson`, but accepts the validated
  // contract value here (it normalises both internally).
  const query = mongoQuery<TContract>({ contractJson: contract });

  // Single source of truth for the lifecycle. `runtimePromise` is the in-flight
  // or settled build; `closed` is the terminal state set by `close()`. A failed
  // build resets `runtimePromise` so a retry is possible (see test).
  let runtimePromise: Promise<MongoRuntime> | undefined;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const buildRuntime = async (resolvedBinding: MongoBinding): Promise<MongoRuntime> => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract, stack });
    const driver =
      resolvedBinding.kind === 'url'
        ? await MongoDriverImpl.fromConnection(resolvedBinding.url, resolvedBinding.dbName)
        : MongoDriverImpl.fromDb(resolvedBinding.client.db(resolvedBinding.dbName));
    if (resolvedBinding.kind === 'url') {
      ownedDispose = () => driver.close();
    }
    return createMongoRuntime({
      context,
      driver,
      ...ifDefined('mode', options.mode),
      ...ifDefined('middleware', options.middleware),
    });
  };

  const getRuntime = (): Promise<MongoRuntime> => {
    if (closed) {
      return Promise.reject(new Error('Mongo client is closed'));
    }
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

  function execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
    async function* iterate(): AsyncGenerator<Row, void, unknown> {
      const runtime = await getRuntime();
      yield* runtime.execute(plan);
    }
    return new AsyncIterableResult(iterate());
  }

  const orm = mongoOrm<TContract>({
    contract,
    executor: { execute },
  });

  const raw = mongoRaw<TContract>({ contract });

  const enums: UnboundEnums<TContract> = unboundNamespace(
    Object.freeze(buildNamespacedEnums(contract.domain)),
  );

  return {
    orm,
    query,
    raw,
    contract,
    enums,
    execute,

    async connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime> {
      if (closed) {
        throw new Error('Mongo client is closed');
      }
      if (runtimePromise !== undefined) {
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
      if (closed) return;
      closed = true;
      if (runtimePromise === undefined) return;
      // Await whatever the build resolved to. Swallow build failures because
      // the user's intent is "release any resources we acquired" — there is
      // nothing to close if the build never produced a runtime.
      try {
        await runtimePromise;
      } catch {
        // build failed; still attempt disposing any already-acquired owned driver.
      }
      const dispose = ownedDispose;
      ownedDispose = undefined;
      await dispose?.();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
