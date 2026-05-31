import type { ContractModelBase, ContractValueObject } from './domain-types';

export const UNBOUND_DOMAIN_NAMESPACE_ID = '__unbound__' as const;

/**
 * One namespace slice of the framework domain plane — models and optional
 * value objects keyed by entity name within that namespace coordinate.
 */
export interface DomainNamespace<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
}

/**
 * Framework domain plane envelope: entity content keyed by namespace id.
 * Mirrors the storage plane's `namespaces` segment (ADR 221).
 */
export interface DomainPlane<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly namespaces: Readonly<Record<string, DomainNamespace<TModels>>>;
}

export type DomainContractSlice = {
  readonly domain: DomainPlane;
};

/** Pre-domain-envelope contract root still carrying flat `models` / `valueObjects`. */
export type LegacyFlatDomainRoot = {
  readonly models?: Record<string, ContractModelBase>;
  readonly valueObjects?: Record<string, ContractValueObject>;
};

export type DomainContractInput = DomainContractSlice | LegacyFlatDomainRoot;

function domainNamespacesOf(contract: DomainContractInput): DomainPlane['namespaces'] | undefined {
  if (!('domain' in contract) || contract.domain?.namespaces === undefined) {
    return undefined;
  }
  return contract.domain.namespaces;
}

export function contractModels(contract: DomainContractInput): Record<string, ContractModelBase> {
  const namespaces = domainNamespacesOf(contract);
  if (namespaces !== undefined) {
    const merged: Record<string, ContractModelBase> = {};
    for (const ns of Object.values(namespaces)) {
      Object.assign(merged, ns.models);
    }
    return merged;
  }
  return contract.models ?? {};
}

export function contractValueObjects(
  contract: DomainContractInput,
): Record<string, ContractValueObject> | undefined {
  const namespaces = domainNamespacesOf(contract);
  if (namespaces !== undefined) {
    const merged: Record<string, ContractValueObject> = {};
    let any = false;
    for (const ns of Object.values(namespaces)) {
      if (ns.valueObjects === undefined) continue;
      any = true;
      Object.assign(merged, ns.valueObjects);
    }
    return any ? merged : undefined;
  }
  return contract.valueObjects;
}

export function buildDomainPlaneFromFlat(params: {
  readonly models: Record<string, ContractModelBase>;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly namespaceId?: string;
}): DomainPlane {
  const namespaceId = params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  return {
    namespaces: {
      [namespaceId]: {
        models: params.models,
        ...(params.valueObjects !== undefined ? { valueObjects: params.valueObjects } : {}),
      },
    },
  };
}

/**
 * Lifts a legacy flat `models` / `valueObjects` contract root into
 * `domain.namespaces.__unbound__` when the domain envelope is absent.
 */
export function normalizeLegacyDomainRoot(value: Record<string, unknown>): Record<string, unknown> {
  if (value['domain'] !== undefined && value['domain'] !== null) {
    return value;
  }
  const models = value['models'];
  if (models === undefined || typeof models !== 'object' || models === null) {
    return value;
  }
  const valueObjects = value['valueObjects'];
  const namespace: Record<string, unknown> = { models };
  if (
    valueObjects !== undefined &&
    typeof valueObjects === 'object' &&
    valueObjects !== null &&
    !Array.isArray(valueObjects)
  ) {
    namespace['valueObjects'] = valueObjects;
  }
  const { models: _m, valueObjects: _vo, ...rest } = value;
  return {
    ...rest,
    domain: {
      namespaces: {
        [UNBOUND_DOMAIN_NAMESPACE_ID]: namespace,
      },
    },
  };
}
