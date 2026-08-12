import mongoAdapter from '@prisma-next/adapter-mongo/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@prisma-next/cli/control-api';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';
import { ifDefined } from '@prisma-next/utils/defined';

export interface MongoControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createMongoControlClient(options: MongoControlClientOptions = {}): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
