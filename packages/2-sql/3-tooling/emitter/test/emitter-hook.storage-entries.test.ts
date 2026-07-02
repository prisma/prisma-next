import { generateContractDts } from '@prisma-next/emitter';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { identityCodecLookup } from './value-set-codec-lookups';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

function contractWithEntries() {
  return createContract({
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { models: {} },
      },
    },
    storage: {
      namespaces: {
        auth: {
          id: 'auth',
          entries: {
            table: {
              sessions: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            valueSet: {
              AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
            },
            native_enum: {
              AalLevel: {
                kind: 'postgres-enum',
                typeName: 'aal_level',
                members: [
                  { name: 'aal1', value: 'aal1' },
                  { name: 'aal2', value: 'aal2' },
                  { name: 'aal3', value: 'aal3' },
                ],
              },
            },
            role: {
              app_user: { kind: 'postgres-role', name: 'app_user', namespaceId: 'auth' },
            },
          },
        },
      },
    },
  });
}

describe('storage namespace entries type emission', () => {
  it('emits every entries slot, literalizing pack-contributed slots generically', () => {
    const dts = generateContractDts(
      contractWithEntries(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    // The native_enum slot is emitted with literal member types — this is what
    // makes literal accessor typing (db.nativeEnums) possible.
    expect(dts).toContain(
      "readonly native_enum: { readonly AalLevel: { readonly kind: 'postgres-enum'; readonly typeName: 'aal_level'; readonly members: readonly [{ readonly name: 'aal1'; readonly value: 'aal1' }, { readonly name: 'aal2'; readonly value: 'aal2' }, { readonly name: 'aal3'; readonly value: 'aal3' }] } }",
    );
    // Other pack slots ride the same generic path — the emitter has no
    // family→target knowledge of what `role` is.
    expect(dts).toContain(
      "readonly role: { readonly app_user: { readonly kind: 'postgres-role'; readonly name: 'app_user'; readonly namespaceId: 'auth' } }",
    );
  });

  it('keeps the valueSet slot emission byte-identical to the previous dedicated path', () => {
    const dts = generateContractDts(
      contractWithEntries(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).toContain(
      "readonly valueSet: { readonly AalLevel: { readonly kind: 'valueSet'; readonly values: readonly ['aal1', 'aal2', 'aal3'] } }",
    );
  });

  it('omits empty non-table slots', () => {
    const contract = createContract({
      domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {},
              native_enum: {},
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).not.toContain('native_enum');
  });
});
