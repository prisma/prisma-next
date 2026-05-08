import type { Codec, CodecInstanceContext } from '@prisma-next/framework-components/codec';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { codecDefinitions } from '../core/codecs';
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';
import { postgisPackMeta, postgisQueryOperations } from '../core/descriptor-meta';

const geometryParamsSchema = arktype({
  srid: 'number',
}).narrow((params, ctx) => {
  const { srid } = params;
  if (!Number.isInteger(srid)) {
    return ctx.mustBe('an integer');
  }
  if (srid < 0) {
    return ctx.mustBe('a non-negative integer');
  }
  return true;
});

// The geometry codec's encode/decode is parameter-independent — the wire
// format already carries SRID inside the EWKT/EWKB payload, so the resolved
// codec for every `(srid)` instance is the same shared codec object today.
// The factory returns it directly; `ctx` is unused. When a future refactor
// wants per-instance state (e.g. SRID cross-checks), the closure over
// `params` is the place to add it.
const sharedGeometryCodec: Codec = codecDefinitions.geometry.codec;
const geometryFactory = (_params: { readonly srid: number }) => (_ctx: CodecInstanceContext) =>
  sharedGeometryCodec;

const parameterizedCodecDescriptors = [
  {
    codecId: POSTGIS_GEOMETRY_CODEC_ID,
    traits: ['equality'] as const,
    targetTypes: ['geometry'] as const,
    paramsSchema: geometryParamsSchema,
    renderOutputType: (params: { readonly srid: number }) => `Geometry<${params.srid}>`,
    factory: geometryFactory,
  },
] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor<{ readonly srid: number }>>;

function createPostgisCodecRegistry() {
  const registry = createCodecRegistry();
  for (const def of Object.values(codecDefinitions)) {
    registry.register(def.codec);
  }
  return registry;
}

const postgisRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: postgisPackMeta.id,
  version: postgisPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Mirror `postgisPackMeta.types.codecTypes.codecInstances` here so that
  // runtime-plane assemblers driven by `extractCodecLookup` discover
  // `pg/geometry@1`. Without it, the Postgres adapter's runtime codec
  // lookup would miss the geometry codec and `$N::geometry` casts would
  // disappear once the renderer switches to lookup-driven cast policy.
  types: {
    codecTypes: {
      codecInstances: Object.values(codecDefinitions).map((def) => def.codec),
    },
  },
  codecs: createPostgisCodecRegistry,
  queryOperations: () => postgisQueryOperations(),
  parameterizedCodecs: () => parameterizedCodecDescriptors,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default postgisRuntimeDescriptor;
