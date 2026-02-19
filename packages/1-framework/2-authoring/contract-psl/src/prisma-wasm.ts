import prismaSchemaWasm from '@prisma/prisma-schema-wasm';

interface PrismaSchemaWasmModule {
  get_config(params: string): string;
  get_dmmf(params: string): string;
}

interface PrismaConfigError {
  readonly message?: string;
}

interface PrismaConfigResponse<TConfig> {
  readonly config: TConfig;
  readonly errors: ReadonlyArray<PrismaConfigError>;
}

interface WasmPanicRegistry {
  readonly get: () => string;
  readonly set_message: (value: string) => void;
}

declare global {
  // Prisma wasm panic hooks write panic messages here.
  // eslint-disable-next-line no-var
  var PRISMA_WASM_PANIC_REGISTRY: WasmPanicRegistry | undefined;
}

function ensureWasmPanicRegistry(): void {
  if (globalThis.PRISMA_WASM_PANIC_REGISTRY) {
    return;
  }
  let message = '';
  globalThis.PRISMA_WASM_PANIC_REGISTRY = {
    get: () => message,
    set_message: (value: string) => {
      message = `RuntimeError: ${value}`;
    },
  };
}

function parseJson<T>(value: string, action: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse Prisma wasm ${action} response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function getPrismaConfig<TConfig>(datamodel: string): TConfig {
  ensureWasmPanicRegistry();
  const wasm = prismaSchemaWasm as unknown as PrismaSchemaWasmModule;

  let rawResult = '';
  try {
    rawResult = wasm.get_config(JSON.stringify({ prismaSchema: datamodel }));
  } catch (error) {
    const panicMessage = globalThis.PRISMA_WASM_PANIC_REGISTRY?.get();
    throw new Error(
      panicMessage && panicMessage.length > 0
        ? panicMessage
        : `Prisma wasm get_config failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
    );
  }

  const parsed = parseJson<PrismaConfigResponse<TConfig>>(rawResult, 'get_config');
  if (parsed.errors.length > 0) {
    const details = parsed.errors
      .map((error) => error.message ?? '')
      .filter(Boolean)
      .join('\n\n');
    throw new Error(
      details.length > 0
        ? details
        : 'Prisma schema validation failed while resolving datasource config.',
    );
  }

  return parsed.config;
}

export function getPrismaDmmf<TDmmf>(datamodel: string): TDmmf {
  ensureWasmPanicRegistry();
  const wasm = prismaSchemaWasm as unknown as PrismaSchemaWasmModule;

  let rawResult = '';
  try {
    rawResult = wasm.get_dmmf(
      JSON.stringify({
        prismaSchema: datamodel,
        noColor: Boolean(process.env.NO_COLOR),
      }),
    );
  } catch (error) {
    const panicMessage = globalThis.PRISMA_WASM_PANIC_REGISTRY?.get();
    throw new Error(
      panicMessage && panicMessage.length > 0
        ? panicMessage
        : `Prisma wasm get_dmmf failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseJson<TDmmf>(rawResult, 'get_dmmf');
}
