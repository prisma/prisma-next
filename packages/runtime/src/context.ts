import type { Adapter } from '@prisma-next/sql-query/types';
import type {
  CodecRegistry,
  OperationRegistry,
  OperationSignature,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry, createOperationRegistry } from '@prisma-next/sql-target';

export interface RuntimeContext {
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
  readonly adapter: Adapter<unknown, TContract, unknown>;
  readonly extensions?: ReadonlyArray<Extension>;
}

export function createRuntimeContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(options: CreateRuntimeContextOptions<TContract>): RuntimeContext {
  const { adapter, extensions } = options;

  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  // Treat adapter as an extension (it provides codecs via profile.codecs())
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
    operations: operationRegistry,
    codecs: codecRegistry,
  };
}
