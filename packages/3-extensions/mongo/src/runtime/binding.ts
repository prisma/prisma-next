import type { MongoClient as MongoDriverClient } from 'mongodb';

export type MongoBinding =
  | { readonly kind: 'url'; readonly url: string; readonly dbName: string }
  | {
      readonly kind: 'mongoClient';
      readonly client: MongoDriverClient;
      readonly dbName: string;
    };

export type MongoBindingInput =
  | {
      readonly binding: MongoBinding;
      readonly url?: never;
      readonly uri?: never;
      readonly dbName?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly url: string;
      readonly dbName?: string;
      readonly binding?: never;
      readonly uri?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly uri: string;
      readonly dbName: string;
      readonly binding?: never;
      readonly url?: never;
      readonly mongoClient?: never;
    }
  | {
      readonly mongoClient: MongoDriverClient;
      readonly dbName: string;
      readonly binding?: never;
      readonly url?: never;
      readonly uri?: never;
    };

type MongoBindingFields = {
  readonly binding?: MongoBinding;
  readonly url?: string;
  readonly uri?: string;
  readonly dbName?: string;
  readonly mongoClient?: MongoDriverClient;
};

function validateMongoUrl(url: string): URL {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error('Mongo URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Mongo URL must be a valid URL');
  }

  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new Error('Mongo URL must use mongodb:// or mongodb+srv://');
  }

  return parsed;
}

function extractDbNameFromUrl(parsed: URL): string | undefined {
  // pathname is "/dbname" or "" — strip the leading slash. Anything past
  // a second slash is invalid for our purposes (auth-source style paths).
  const path = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  if (path.length === 0) {
    return undefined;
  }
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

export function resolveMongoBinding(options: MongoBindingInput): MongoBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.uri !== undefined) +
    Number(options.mongoClient !== undefined);

  if (providedCount !== 1) {
    throw new Error('Provide one binding input: binding, url, uri+dbName, or mongoClient+dbName');
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    const parsed = validateMongoUrl(options.url);
    const dbName = options.dbName ?? extractDbNameFromUrl(parsed);
    if (dbName === undefined || dbName.length === 0) {
      throw new Error(
        'Mongo URL must include a database name in its path (e.g. mongodb://host:27017/mydb), or pass dbName explicitly',
      );
    }
    return { kind: 'url', url: options.url.trim(), dbName };
  }

  if (options.uri !== undefined) {
    validateMongoUrl(options.uri);
    if (options.dbName === undefined || options.dbName.length === 0) {
      throw new Error('Mongo binding via { uri, dbName } requires a non-empty dbName');
    }
    return { kind: 'url', url: options.uri.trim(), dbName: options.dbName };
  }

  const mongoClient = options.mongoClient;
  if (mongoClient === undefined) {
    throw new Error('Invariant violation: expected mongo binding after validation');
  }
  if (options.dbName === undefined || options.dbName.length === 0) {
    throw new Error('Mongo binding via { mongoClient, dbName } requires a non-empty dbName');
  }
  return { kind: 'mongoClient', client: mongoClient, dbName: options.dbName };
}

export function resolveOptionalMongoBinding(options: MongoBindingFields): MongoBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.uri !== undefined) +
    Number(options.mongoClient !== undefined);

  if (providedCount === 0) {
    return undefined;
  }

  return resolveMongoBinding(options as MongoBindingInput);
}
