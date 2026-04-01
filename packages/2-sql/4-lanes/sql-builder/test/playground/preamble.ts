import type { Db } from '../../src';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

export { db };
