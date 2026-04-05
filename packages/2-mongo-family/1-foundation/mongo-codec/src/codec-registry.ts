import type { MongoCodec } from './codecs';

export interface MongoCodecRegistry {
  get(id: string): MongoCodec<string> | undefined;
  has(id: string): boolean;
  register(codec: MongoCodec<string>): void;
  [Symbol.iterator](): Iterator<MongoCodec<string>>;
  values(): IterableIterator<MongoCodec<string>>;
}

class MongoCodecRegistryImpl implements MongoCodecRegistry {
  readonly #byId = new Map<string, MongoCodec<string>>();

  get(id: string): MongoCodec<string> | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  register(codec: MongoCodec<string>): void {
    if (this.#byId.has(codec.id)) {
      throw new Error(`Codec with ID '${codec.id}' is already registered`);
    }
    this.#byId.set(codec.id, codec);
  }

  *[Symbol.iterator](): Iterator<MongoCodec<string>> {
    yield* this.#byId.values();
  }

  values(): IterableIterator<MongoCodec<string>> {
    return this.#byId.values();
  }
}

export function createMongoCodecRegistry(): MongoCodecRegistry {
  return new MongoCodecRegistryImpl();
}
