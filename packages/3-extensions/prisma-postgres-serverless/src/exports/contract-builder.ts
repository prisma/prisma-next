/**
 * Placeholder `defineContract` for the prisma-postgres-serverless facade.
 * The package shell ships before the runtime wiring does; the substantive
 * implementation lands in a follow-up. Calling it throws at runtime — the
 * type signature exists so consumers compile against the eventual shape.
 */

const NOT_IMPLEMENTED_MESSAGE =
  'prisma-postgres-serverless: defineContract is not yet implemented; this is a scaffold package whose runtime wiring is pending. Use @prisma-next/postgres for the time being.';

export function defineContract(..._args: ReadonlyArray<unknown>): never {
  throw new Error(NOT_IMPLEMENTED_MESSAGE);
}
