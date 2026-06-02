import type { Client } from '@prisma/ppg';
import { blindCast } from '@prisma-next/utils/casts';

type PpgClient = Client;

/**
 * Discriminated union of accepted facade bindings. Mirrors the driver's
 * `PpgBinding` shape so that the facade can pass the binding through to the
 * driver unchanged.
 *
 * Compared to the long-lived TCP facade there is no `pgPool` variant: PPG
 * handles pooling on the wire side, so the driver does not own (or expose)
 * a pool object.
 */
export type PpgServerlessBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'ppgClient'; readonly client: PpgClient };

/**
 * Input shape accepted by `runtime(...)` and `db.connect(...)`. Callers pass
 * exactly one of `binding` (explicit) / `url` (string shortcut) /
 * `ppgClient` (object shortcut). The runtime resolves to a
 * `PpgServerlessBinding` via `resolvePpgServerlessBinding`.
 */
export type PpgServerlessBindingInput =
  | {
      readonly binding: PpgServerlessBinding;
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
  readonly binding?: PpgServerlessBinding;
  readonly url?: string;
  readonly ppgClient?: PpgClient;
};

function validatePpgUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error('Postgres URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Postgres URL must be a valid URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Postgres URL must use postgres:// or postgresql://');
  }

  return trimmed;
}

export function resolvePpgServerlessBinding(
  options: PpgServerlessBindingInput,
): PpgServerlessBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.ppgClient !== undefined);

  if (providedCount !== 1) {
    throw new Error('Provide one binding input: binding, url, or ppgClient');
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validatePpgUrl(options.url) };
  }

  const ppgClient = options.ppgClient;
  if (ppgClient === undefined) {
    throw new Error('Invariant violation: expected ppgClient binding after validation');
  }

  return { kind: 'ppgClient', client: ppgClient };
}

export function resolveOptionalPpgServerlessBinding(
  options: PpgServerlessBindingFields,
): PpgServerlessBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.ppgClient !== undefined);

  if (providedCount === 0) {
    return undefined;
  }

  return resolvePpgServerlessBinding(
    blindCast<
      PpgServerlessBindingInput,
      'the optional shape (PpgServerlessBindingFields) widens binding/url/ppgClient to all-optional; the providedCount === 1 invariant above narrows to exactly one defined key, which is structurally what PpgServerlessBindingInput encodes via its discriminated never-fields, but TypeScript cannot follow the narrowing across the helper boundary'
    >(options),
  );
}
