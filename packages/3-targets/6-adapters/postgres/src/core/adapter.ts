import type {
  AnyCodecDescriptor,
  CodecInstanceContext,
  CodecLookup,
} from '@prisma-next/framework-components/codec';
import type {
  Adapter,
  AdapterProfile,
  AnyQueryAst,
  Codec,
  CodecRegistry,
  LowererContext,
} from '@prisma-next/sql-relational-core/ast';
import { parseContractMarkerRow } from '@prisma-next/sql-runtime';
import { codecDescriptorClassList } from '@prisma-next/target-postgres/codecs';
import { createPostgresBuiltinCodecLookup } from './codec-lookup';
import { renderLoweredSql } from './sql-renderer';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
  },
  sql: {
    enums: true,
    returning: true,
    defaultInInsert: true,
  },
});

class PostgresAdapterImpl
  implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement>
{
  // These fields make the adapter instance structurally compatible with
  // RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry: CodecRegistry = (() => {
    const byId = new Map<string, Codec<string>>();
    // Materialize a canonical codec instance per class-form descriptor.
    // Parameterized postgres codecs are parameter-stateless at runtime
    // (params only inform emit-path metadata + renderOutputType), so a
    // single instance per codec id is sufficient for the adapter's runtime
    // encode/decode path. The B5 swap reads from the unified
    // `codecs:` slot's class-form descriptor list.
    const synthCtx: CodecInstanceContext = { name: 'postgres-builtin-adapter' };
    for (const descriptor of codecDescriptorClassList) {
      const factory = (
        descriptor as AnyCodecDescriptor & {
          factory: (params: unknown) => (ctx: CodecInstanceContext) => Codec<string>;
        }
      ).factory(undefined);
      const codec = factory(synthCtx);
      byId.set(codec.id, codec);
    }
    return {
      get: (id) => byId.get(id),
      has: (id) => byId.has(id),
      register: (c) => {
        if (byId.has(c.id)) throw new Error(`Codec with ID '${c.id}' is already registered`);
        byId.set(c.id, c);
      },
      values: () => byId.values(),
      [Symbol.iterator]: function* () {
        yield* byId.values();
      },
    };
  })();
  private readonly codecLookup: CodecLookup;

  constructor(options?: PostgresAdapterOptions) {
    this.codecLookup = options?.codecLookup ?? createPostgresBuiltinCodecLookup();
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
      readMarkerStatement: () => ({
        sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where id = $1',
        params: [1],
      }),
      // Postgres' driver hydrates `text[]` columns as native JS arrays, so
      // the row is already in the shape the shared parser expects.
      parseMarkerRow: (row: unknown) => parseContractMarkerRow(row),
    });
  }

  lower(ast: AnyQueryAst, context: LowererContext<PostgresContract>): PostgresLoweredStatement {
    return renderLoweredSql(ast, context.contract, this.codecLookup);
  }
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
