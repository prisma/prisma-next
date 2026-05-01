/**
 * Negative type tests for AC-ENV4: the handle has no public TypeScript surface.
 *
 * - The handle type itself must not be importable from any subpath.
 * - The `EncryptedString` class must not expose a handle accessor (e.g.
 *   `envelope.handle` / `envelope.plaintext` / `envelope.ciphertext`).
 *
 * These assertions use the `@ts-expect-error` directive in a position
 * permitted by AGENTS.md (negative type tests).
 */

import { EncryptedString } from '../src/exports/index';

const envelope = EncryptedString.from('alice@example.com');

// @ts-expect-error — handle accessor is not part of the public surface.
envelope.handle;
// @ts-expect-error — plaintext accessor is not part of the public surface.
envelope.plaintext;
// @ts-expect-error — ciphertext accessor is not part of the public surface.
envelope.ciphertext;

// The public namespace exposes `EncryptedString` (and, eventually, `decryptAll`).
// It must NOT export a handle type.
type PublicSurface = typeof import('../src/exports/index');
// @ts-expect-error — `EncryptedStringHandle` is not part of the public surface.
type _NoHandle = PublicSurface['EncryptedStringHandle'];

// Public methods on `EncryptedString` are limited to `decrypt` and `toJSON`.
const _decrypt: (opts?: { signal?: AbortSignal }) => Promise<string> =
  envelope.decrypt.bind(envelope);
const _toJson: () => unknown = envelope.toJSON.bind(envelope);

export type _AssertNoHandle = _NoHandle;
void _decrypt;
void _toJson;
