/**
 * The `/runtime` descriptor is the piece a consuming app passes to
 * `postgres({ extensions })` so a client can be constructed over an
 * aggregate contract that records the better-auth pack requirement.
 * The "fails iff" surface: without the descriptor the runtime rejects
 * the aggregate with the missing-pack error; with it, construction
 * succeeds.
 */
import postgres from '@prisma-next/postgres/runtime';
import { describe, expect, it } from 'vitest';
import betterAuthPack from '../src/exports/pack';
import betterAuthRuntimeDescriptor from '../src/exports/runtime';

/**
 * What `prisma-next contract emit` stamps onto the aggregate contract of
 * an app that lists the pack in `extensionPacks` (shape verified against
 * an emitted aggregate: `{ familyId, id, kind, targetId, version }`).
 */
function aggregateContractJson(): Record<string, unknown> {
  const spaceJson = JSON.parse(
    JSON.stringify(betterAuthPack.contractSpace?.contractJson),
  ) as Record<string, unknown>;
  spaceJson['extensionPacks'] = {
    'better-auth': {
      familyId: 'sql',
      id: 'better-auth',
      kind: 'extension',
      targetId: 'postgres',
      version: betterAuthPack.version,
    },
  };
  return spaceJson;
}

const UNUSED_URL = 'postgres://unused:unused@127.0.0.1:9/unused';

describe('better-auth runtime descriptor', () => {
  it('carries the pack identity coordinates', () => {
    expect(betterAuthRuntimeDescriptor).toMatchObject({
      kind: 'extension',
      id: betterAuthPack.id,
      version: betterAuthPack.version,
      familyId: 'sql',
      targetId: 'postgres',
    });
    expect(betterAuthRuntimeDescriptor.codecs()).toEqual([]);
    expect(betterAuthRuntimeDescriptor.create()).toEqual({
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('unblocks postgres() over an aggregate contract requiring the pack', async () => {
    // Without the descriptor: the runtime rejects the aggregate.
    expect(() =>
      postgres({ contractJson: aggregateContractJson(), url: UNUSED_URL, verifyMarker: false }),
    ).toThrow(/requires extension pack.*better-auth/);

    // With it: construction succeeds (no connection is opened until a query runs).
    const db = postgres({
      contractJson: aggregateContractJson(),
      url: UNUSED_URL,
      extensions: [betterAuthRuntimeDescriptor],
      verifyMarker: false,
    });
    await db.close();
  });
});
