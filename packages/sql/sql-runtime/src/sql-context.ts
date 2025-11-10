import type { OperationRegistry } from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import type {
  Adapter,
  CodecRegistry,
  LoweredStatement,
  OperationSignature,
  QueryAst,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';

export interface RuntimeContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly adapter:
    | Adapter<QueryAst, TContract, LoweredStatement>
    | Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly operations: OperationRegistry;
  readonly codecs: CodecRegistry;
}

export interface Extension {
  codecs?(): CodecRegistry;
  operations?(): ReadonlyArray<OperationSignature>;
}

export interface CreateRuntimeContextOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly adapter:
    | Adapter<QueryAst, TContract, LoweredStatement>
    | Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly extensions?: ReadonlyArray<Extension>;
}

export function createRuntimeContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(options: CreateRuntimeContextOptions<TContract>): RuntimeContext<TContract> {
  const { contract, adapter, extensions } = options;

  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  const allExtensions: ReadonlyArray<Extension> = [
    {
      codecs: () => adapter.profile.codecs(),
    },
    ...(extensions ?? []),
  ];

  for (const extension of allExtensions) {
    const extensionCodecs = extension.codecs?.();
    if (extensionCodecs) {
      for (const codec of extensionCodecs.values()) {
        codecRegistry.register(codec);
      }
    }

    const extensionOperations = extension.operations?.();
    if (extensionOperations) {
      for (const operation of extensionOperations) {
        operationRegistry.register(operation);
      }
    }
  }

  return {
    contract,
    adapter,
    operations: operationRegistry,
    codecs: codecRegistry,
  };
}
