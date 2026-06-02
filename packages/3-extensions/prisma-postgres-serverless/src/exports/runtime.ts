/**
 * Placeholder runtime factory for the prisma-postgres-serverless facade.
 * The package shell ships before the runtime wiring does; the substantive
 * `runtime()` (closure-cached sql / context / stack / contract roots,
 * `connect()` returning a fresh `Runtime & AsyncDisposable` per call) lands
 * in a follow-up. Calling the default export throws at runtime — the type
 * signature exists so consumers compile against the eventual shape.
 */

const NOT_IMPLEMENTED_MESSAGE =
  'prisma-postgres-serverless: runtime() is not yet implemented; this is a scaffold package whose runtime wiring is pending. Use @prisma-next/postgres for the time being.';

/**
 * Connection binding accepted by the facade. The exact shape is reserved by
 * the follow-up; this scaffold publishes the minimum union the facade will
 * need to discriminate at runtime.
 */
export type PpgServerlessFacadeBinding = { readonly url: string } | { readonly ppgClient: unknown };

export interface PrismaPostgresServerlessOptions {
  readonly binding: PpgServerlessFacadeBinding;
}

export default function runtime(_options: PrismaPostgresServerlessOptions): never {
  throw new Error(NOT_IMPLEMENTED_MESSAGE);
}
