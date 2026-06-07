import type { ContractEnum, ContractModelBase, ContractValueObject } from './domain-types';

export { UNBOUND_DOMAIN_NAMESPACE_ID } from './default-namespace';

/**
 * One namespace's application-domain entities — models and optional value
 * objects keyed by entity name within that namespace coordinate.
 */
export interface ApplicationDomainNamespace<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly enum?: Record<string, ContractEnum>;
}

/**
 * Application-domain envelope: entity content keyed by namespace id.
 * Mirrors the storage plane's `namespaces` segment (ADR 221).
 */
export interface ApplicationDomain<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly namespaces: Readonly<Record<string, ApplicationDomainNamespace<TModels>>>;
}

export type ContractWithDomain = {
  readonly domain: ApplicationDomain;
};
