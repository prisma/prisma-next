/**
 * Placeholder `defineConfig` for the prisma-postgres-serverless facade. The
 * package shell ships before the runtime wiring does; the substantive
 * implementation lands in a follow-up that consumes the same surface this
 * stub publishes. Calling it throws at runtime — the type signature exists
 * so consumers compile against the eventual shape.
 */

const NOT_IMPLEMENTED_MESSAGE =
  'prisma-postgres-serverless: defineConfig is not yet implemented; this is a scaffold package whose runtime wiring is pending. Use @prisma-next/postgres for the time being.';

// biome-ignore lint/suspicious/noEmptyInterface: shape pinned by the follow-up that fills the body; reserved here so downstream call sites typecheck against the eventual public surface
export interface PrismaPostgresServerlessConfigOptions {}

export function defineConfig(_options: PrismaPostgresServerlessConfigOptions): never {
  throw new Error(NOT_IMPLEMENTED_MESSAGE);
}
