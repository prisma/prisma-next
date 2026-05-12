import type {
  ContractSpace,
  ControlExtensionDescriptor,
} from '@prisma-next/framework-components/control';
import type { MongoContract, MongoStorage } from '@prisma-next/mongo-contract';

/**
 * Mongo-family extension descriptor.
 *
 * Extensions that contribute schema opt into the per-space planner /
 * runner / verifier by setting `contractSpace`. Extensions without it
 * are codec-only or query-ops-only — today's behaviour preserved.
 *
 * The shape comes from `@prisma-next/framework-components/control`
 * (`ContractSpace`) — contract-space identity is a framework concept,
 * not a Mongo-specific one. The Mongo family specialises the generic
 * to `MongoContract<MongoStorage>` so descriptor authors continue to
 * see a typed contract value. Mirrors `SqlControlExtensionDescriptor`.
 */
export interface MongoControlExtensionDescriptor
  extends ControlExtensionDescriptor<'mongo', 'mongo'> {
  readonly contractSpace?: ContractSpace<MongoContract<MongoStorage>>;
}
