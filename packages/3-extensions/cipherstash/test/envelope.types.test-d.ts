/**
 * Negative type tests for AC-ENV4 (`envelope-codec-extension.spec.md`).
 *
 * The handle has no public TypeScript surface:
 *   - the handle type itself is not importable from any subpath;
 *   - the `EncryptedString` class exposes no handle accessor.
 *
 * `@ts-expect-error` is permitted in negative type tests per
 * `AGENTS.md § Typesafety rules`.
 */

import { EncryptedString } from '../src/exports/runtime';

const envelope = EncryptedString.from('alice@example.com');

// @ts-expect-error — handle accessor is not part of the public surface.
envelope.handle;
// @ts-expect-error — plaintext accessor is not part of the public surface.
envelope.plaintext;
// @ts-expect-error — ciphertext accessor is not part of the public surface.
envelope.ciphertext;

type PublicSurface = typeof import('../src/exports/runtime');
// @ts-expect-error — `EncryptedStringHandle` is not part of the public surface.
type _NoHandle = PublicSurface['EncryptedStringHandle'];

const _decrypt: (opts?: { signal?: AbortSignal }) => Promise<string> =
  envelope.decrypt.bind(envelope);
const _toJson: () => unknown = envelope.toJSON.bind(envelope);

export type _AssertNoHandle = _NoHandle;
void _decrypt;
void _toJson;
