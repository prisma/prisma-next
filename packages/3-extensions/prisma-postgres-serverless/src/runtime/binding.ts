import type { Client } from '@prisma/ppg';
import type { PpgBinding } from '@prisma-next/driver-ppg-serverless/runtime';

// REVIEW: Remove this type alias
type PpgClient = Client;

// REVIEW: What is the point of this type? Just use PpgBinding as an inpu
/**
 * Input shape accepted by `runtime(...)` and `db.connect(...)`. Callers pass
 * exactly one of `binding` (explicit) / `url` (string shortcut) /
 * `ppgClient` (object shortcut). The discriminated `?: never` fields encode
 * exclusive-one-of at compile time; the resolver below trusts that narrowing
 * and does not re-check at runtime. URL shape is not validated here either —
 * `@prisma/ppg` parses the connection string at `client(config)` construction
 * time and produces the precise error.
 */
export type PpgServerlessBindingInput =
  | {
      readonly binding: PpgBinding;
      readonly url?: never;
      readonly ppgClient?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly ppgClient?: never;
    }
  | {
      readonly ppgClient: PpgClient;
      readonly binding?: never;
      readonly url?: never;
    };

type PpgServerlessBindingFields = {
  readonly binding?: PpgBinding;
  readonly url?: string;
  readonly ppgClient?: PpgClient;
};

export function resolvePpgServerlessBinding(options: PpgServerlessBindingInput): PpgBinding {
  if (options.binding !== undefined) return options.binding;
  if (options.url !== undefined) return { kind: 'url', url: options.url };
  return { kind: 'ppgClient', client: options.ppgClient };
}

export function resolveOptionalPpgServerlessBinding(
  options: PpgServerlessBindingFields,
): PpgBinding | undefined {
  if (options.binding !== undefined) return options.binding;
  if (options.url !== undefined) return { kind: 'url', url: options.url };
  if (options.ppgClient !== undefined) {
    return { kind: 'ppgClient', client: options.ppgClient };
  }
  return undefined;
}
