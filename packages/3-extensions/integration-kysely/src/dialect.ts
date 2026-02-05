import type {
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
} from 'kysely';
import { PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import type { KyselyPrismaDialectConfig } from './config.js';
import { KyselyPrismaDriver } from './driver.js';

export class KyselyPrismaDialect implements Dialect {
  readonly #config: KyselyPrismaDialectConfig;

  createAdapter: () => DialectAdapter;
  createDriver: () => Driver;
  createIntrospector: (db: Kysely<unknown>) => DatabaseIntrospector;
  createQueryCompiler: () => QueryCompiler;

  constructor(config: KyselyPrismaDialectConfig) {
    this.#config = Object.freeze({ ...config });
    const { createAdapter, createDriver, createIntrospector, createQueryCompiler } = matchDialect(
      this.#config,
    );
    this.createAdapter = createAdapter;
    this.createDriver = createDriver;
    this.createIntrospector = createIntrospector;
    this.createQueryCompiler = createQueryCompiler;
  }
}

function matchDialect(config: KyselyPrismaDialectConfig) {
  if (config.contract.target === 'postgres') {
    return {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new KyselyPrismaDriver(config),
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    };
  }
  throw new Error(`Unsupported database target: ${config.contract.target}`);
}
