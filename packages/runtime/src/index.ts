import { DatabaseConnection, ConnectionConfig } from './connection';

export function connect(config: ConnectionConfig): DatabaseConnection {
  return new DatabaseConnection(config);
}

// Contract verifier exports
export { verifyContract, assertContract } from './contract-verifier';
export type { ContractVerifierOptions, ContractVerification } from './contract-verifier';
