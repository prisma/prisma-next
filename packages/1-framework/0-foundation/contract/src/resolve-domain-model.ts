import type { ApplicationDomain } from './domain-envelope';
import type { ContractModelBase } from './domain-types';

export interface ResolvedDomainModel {
  readonly namespaceId: string;
  readonly model: ContractModelBase;
}

export interface ResolveDomainModelOptions {
  readonly defaultNamespaceId?: string;
}

/**
 * Resolve a bare domain model name to its namespace coordinate and model IR.
 * Scans the default namespace first (when given), then every other declared
 * namespace.
 */
export function resolveDomainModel(
  domain: ApplicationDomain,
  modelName: string,
  options: ResolveDomainModelOptions = {},
): ResolvedDomainModel | undefined {
  const { defaultNamespaceId } = options;
  const namespaces = domain.namespaces;

  if (defaultNamespaceId !== undefined) {
    const defaultNamespace = namespaces[defaultNamespaceId];
    const defaultModel = defaultNamespace?.models[modelName];
    if (defaultModel !== undefined) {
      return { namespaceId: defaultNamespaceId, model: defaultModel };
    }
  }

  for (const namespaceId of Object.keys(namespaces)) {
    if (namespaceId === defaultNamespaceId) {
      continue;
    }
    const model = namespaces[namespaceId]?.models[modelName];
    if (model !== undefined) {
      return { namespaceId, model };
    }
  }

  return undefined;
}
