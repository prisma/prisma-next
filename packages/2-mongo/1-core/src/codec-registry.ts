import type { MongoCodec } from './codecs';

export interface MongoCodecRegistry {
  get(id: string): MongoCodec<string> | undefined;
  has(id: string): boolean;
  register(codec: MongoCodec<string>): void;
  [Symbol.iterator](): Iterator<MongoCodec<string>>;
  values(): IterableIterator<MongoCodec<string>>;
}

class MongoCodecRegistryImpl implements MongoCodecRegistry {
  private readonly _byId = new Map<string, MongoCodec<string>>();

  get(id: string): MongoCodec<string> | undefined {
    return this._byId.get(id);
  }

  has(id: string): boolean {
    return this._byId.has(id);
  }

  register(codec: MongoCodec<string>): void {
    if (this._byId.has(codec.id)) {
      throw new Error(`Codec with ID '${codec.id}' is already registered`);
    }
    this._byId.set(codec.id, codec);
  }

  *[Symbol.iterator](): Iterator<MongoCodec<string>> {
    yield* this._byId.values();
  }

  values(): IterableIterator<MongoCodec<string>> {
    return this._byId.values();
  }
}

export function createMongoCodecRegistry(): MongoCodecRegistry {
  return new MongoCodecRegistryImpl();
}
