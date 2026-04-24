import { codec } from '@prisma-next/sql-relational-core/ast';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

async function digestBytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(value)),
  );
}

async function importSeedKey(seed: string) {
  const keyBytes = await digestBytes(`${seed}:key`);
  return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(value: string, seed: string): Promise<string> {
  const [key, iv] = await Promise.all([
    importSeedKey(seed),
    digestBytes(`${seed}:iv:${value}`).then((bytes) => bytes.slice(0, 12)),
  ]);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(value),
  );
  return `${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(wire: string, seed: string): Promise<string> {
  const [ivEncoded, ciphertextEncoded, extra] = wire.split(':');
  if (
    ivEncoded === undefined ||
    ciphertextEncoded === undefined ||
    extra !== undefined ||
    ivEncoded.length === 0 ||
    ciphertextEncoded.length === 0
  ) {
    throw new Error('invalid secret payload');
  }

  const key = await importSeedKey(seed);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivEncoded) },
    key,
    fromBase64(ciphertextEncoded),
  );
  return textDecoder.decode(plaintext);
}

export function createAsyncSecretCodec({
  seed,
  typeId = 'pg/secret@1',
  targetTypes = ['text'],
}: {
  seed: string;
  typeId?: string;
  targetTypes?: readonly string[];
}) {
  return codec({
    typeId,
    targetTypes,
    runtime: { encode: 'async', decode: 'async' } as const,
    encode: (value: string) => encryptSecret(value, seed),
    decode: (wire: string) => decryptSecret(wire, seed),
  });
}
