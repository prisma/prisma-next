import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { codecDefinitions } from '@prisma-next/target-postgres/codecs';
import { type as arktype } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import {
  compileJsonSchemaValidator,
  type JsonSchemaValidateFn,
} from '../core/json-schema-validator';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

const jsonTypeParamsSchema = arktype({
  schemaJson: 'object',
  'type?': 'string',
});

/** The inferred type params shape from the arktype schema. */
type JsonTypeParams = typeof jsonTypeParamsSchema.infer;

/**
 * Per-instance JSON-validator state attached to the resolved JSON/JSONB
 * codec. The `'json-validator'` `CodecTrait` gates the framework's
 * extraction of `validate` from the resolved codec at context-build time.
 */
export type JsonCodecHelper = { readonly validate: JsonSchemaValidateFn };

function createPostgresMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => {
      const spec: GeneratedValueSpec = params ? { id, params } : { id };
      return generateId(spec);
    },
  }));
}

/**
 * Build a parameterized JSON/JSONB descriptor whose factory wraps the
 * existing async json/jsonb codec with a per-instance compiled JSON
 * Schema validator. The resolved codec carries `validate` as a per-
 * instance state and declares the `'json-validator'` trait so the
 * framework's `JsonSchemaValidatorRegistry` builder can extract it.
 *
 * The wire-format `encode`/`decode` behavior is unchanged from the legacy
 * non-parameterized codec — JSON encode is `JSON.stringify`, decode is
 * `JSON.parse` — which is why the AC-5 `forCodecId` fallback works for
 * encode-side dispatch without column refs (encode is per-instance-
 * stateless w.r.t. params; only decode-time validation depends on the
 * compiled validator). Codec-registry-unification spec § Phase B § Risks.
 */
function buildJsonCodecDescriptor(
  codecId: typeof PG_JSON_CODEC_ID | typeof PG_JSONB_CODEC_ID,
  baseCodec: Codec,
  targetType: 'json' | 'jsonb',
): RuntimeParameterizedCodecDescriptor<JsonTypeParams> {
  const factory = (params: JsonTypeParams) => {
    const validate = compileJsonSchemaValidator(params.schemaJson as Record<string, unknown>);
    const baseTraits: ReadonlyArray<string> = baseCodec.traits ?? [];
    const traitsArr = Array.from(new Set([...baseTraits, 'json-validator']));
    const traits = Object.freeze(traitsArr) as NonNullable<Codec['traits']>;
    const resolvedCodec: Codec & JsonCodecHelper = {
      ...baseCodec,
      traits,
      validate,
    };
    return (_ctx: Ctx) => resolvedCodec;
  };

  return {
    codecId,
    traits: ['json-validator', ...(baseCodec.traits ?? [])],
    targetTypes: [targetType],
    paramsSchema: jsonTypeParamsSchema,
    factory,
  };
}

const parameterizedCodecDescriptors: ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<JsonTypeParams>
> = [
  buildJsonCodecDescriptor(PG_JSON_CODEC_ID, codecDefinitions.json.codec, 'json'),
  buildJsonCodecDescriptor(PG_JSONB_CODEC_ID, codecDefinitions.jsonb.codec, 'jsonb'),
];

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    parameterizedCodecs: () => parameterizedCodecDescriptors,
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(stack): SqlRuntimeAdapter {
      // The runtime `ExecutionStack` does not (yet) carry a pre-assembled
      // `codecLookup` field the way the control `ControlStack` does, so we
      // derive an equivalent lookup here from the stack's component metadata
      // (target + adapter + extension packs) using the same assembly helper
      // that `createControlStack` uses. This keeps the renderer fed with the
      // same codec set on both planes — including extension-contributed
      // codecs like `pg/vector@1` from `@prisma-next/extension-pgvector`.
      const codecLookup = extractCodecLookup([
        stack.target,
        stack.adapter,
        ...stack.extensionPacks,
      ]);
      return createPostgresAdapter({ codecLookup });
    },
  };

export default postgresRuntimeAdapterDescriptor;
