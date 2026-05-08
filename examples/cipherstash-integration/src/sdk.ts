/**
 * **Demo-only stub SDK.** Replace with a real CipherStash-backed
 * implementation for any non-toy use.
 *
 * The real ZeroKMS SDK (see `reference/cipherstash/stack/...`) wraps
 * each batch in a per-tenant key request, returns opaque ciphertexts,
 * and authenticates against CipherStash's managed key-broker. This
 * stub does none of that — it tags plaintexts with a `ct:` prefix so
 * the synthetic EQL bundle (see `migrations/cipherstash/...`) can
 * exercise wiring without any real cryptography.
 *
 * The shape it implements is the framework-native `CipherstashSdk`
 * contract — three async methods, no broker handshake, no key
 * material. Real implementations replace the body of each method with
 * a call into the CipherStash client.
 */

import type { CipherstashSdk } from '@prisma-next/extension-cipherstash/runtime';

const CIPHERTEXT_PREFIX = 'ct:';

export function createDemoSdk(): CipherstashSdk {
  return {
    decrypt(args) {
      return Promise.resolve(unwrap(args.ciphertext));
    },
    bulkEncrypt(args) {
      const out = args.values.map((value) => ({
        c: `${CIPHERTEXT_PREFIX}${value}`,
        t: args.routingKey.table,
        col: args.routingKey.column,
      }));
      return Promise.resolve(out);
    },
    bulkDecrypt(args) {
      return Promise.resolve(args.ciphertexts.map((ct) => unwrap(ct)));
    },
  };
}

function unwrap(ciphertext: unknown): string {
  const ct = ciphertext as { c?: string } | null;
  if (!ct || typeof ct.c !== 'string' || !ct.c.startsWith(CIPHERTEXT_PREFIX)) {
    throw new Error(`demo SDK: unrecognized ciphertext ${JSON.stringify(ciphertext)}`);
  }
  return ct.c.slice(CIPHERTEXT_PREFIX.length);
}
