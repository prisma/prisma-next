import {
  defaultDomainNamespaceIdForMongo,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@prisma-next/contract/default-namespace';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

/** Default storage namespace for Mongo-family contracts at runtime. */
export const defaultMongoStorageNamespaceId = UNBOUND_NAMESPACE_ID;

/** Default domain namespace for Mongo-family contracts at runtime. */
export const defaultMongoDomainNamespaceId = UNBOUND_DOMAIN_NAMESPACE_ID;

export { defaultDomainNamespaceIdForMongo };
