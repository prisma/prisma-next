import { createMongoCodecRegistry } from '@prisma-next/mongo-codec';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { resolveValue } from '../../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value';

// T4.1 — cross-family codec parity proof
//
// A single `codec({...})` value (the unified factory entry point in
// relational-core, mirrored by `mongoCodec` post-m4) is registered in both a
// SQL `CodecRegistry` and a Mongo `MongoCodecRegistry`. Encoding the same
// input value through each registry must produce identical wire output. For
// the SQL fixture the same codec also round-trips via `decode`, demonstrating
// that one codec definition can serve both directional boundaries.

describe('cross-family codec parity (T4.1)', () => {
  // A single codec instance — registered in both SQL and Mongo registries.
  const objectIdLikeCodec = codec({
    typeId: 'shared/object-id-like@1',
    targetTypes: ['objectIdLike'],
    encode: (value: string) => `wire:${value}`,
    decode: (wire: string) => wire.replace(/^wire:/, ''),
  });

  it('produces identical wire output through both family registries', async () => {
    const sqlRegistry = createCodecRegistry();
    sqlRegistry.register(objectIdLikeCodec);
    const mongoRegistry = createMongoCodecRegistry();
    mongoRegistry.register(objectIdLikeCodec);

    const sqlCodec = sqlRegistry.get('shared/object-id-like@1');
    const mongoCodecLookup = mongoRegistry.get('shared/object-id-like@1');
    if (!sqlCodec || !mongoCodecLookup?.encode) {
      throw new Error('codec not registered in one of the family registries');
    }

    const sqlWire = await sqlCodec.encode!('abc-123');
    const mongoWire = await mongoCodecLookup.encode('abc-123');

    expect(sqlWire).toBe('wire:abc-123');
    expect(mongoWire).toBe('wire:abc-123');
    expect(sqlWire).toEqual(mongoWire);
  });

  it('encoding through Mongo resolveValue matches SQL codec.encode result', async () => {
    const sqlRegistry = createCodecRegistry();
    sqlRegistry.register(objectIdLikeCodec);
    const mongoRegistry = createMongoCodecRegistry();
    mongoRegistry.register(objectIdLikeCodec);

    const sqlCodec = sqlRegistry.get('shared/object-id-like@1');
    if (!sqlCodec?.encode) throw new Error('SQL codec missing encode');

    const sqlWire = await sqlCodec.encode('abc-123');
    const mongoWire = await resolveValue(
      new MongoParamRef('abc-123', { codecId: 'shared/object-id-like@1' }),
      mongoRegistry,
    );

    expect(mongoWire).toBe('wire:abc-123');
    expect(sqlWire).toEqual(mongoWire);
  });

  it('round-trips: SQL decode is the inverse of SQL encode', async () => {
    const sqlRegistry = createCodecRegistry();
    sqlRegistry.register(objectIdLikeCodec);

    const sqlCodec = sqlRegistry.get('shared/object-id-like@1');
    if (!sqlCodec?.encode) throw new Error('SQL codec missing encode');

    const wire = await sqlCodec.encode('abc-123');
    expect(wire).toBe('wire:abc-123');

    const decoded = await sqlCodec.decode(wire);
    expect(decoded).toBe('abc-123');
  });
});
