import contractData from './contract.json' assert { type: 'json' };
import type { SqlContract } from '@prisma-next/contract/types';

// Export the contract data with proper typing
// The contract.d.ts provides the Contract namespace types for DSL/ORM usage
export default contractData as Readonly<SqlContract>;

