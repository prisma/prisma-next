import { DatabaseConnection, ConnectionConfig } from './connection';

export function connect(config: ConnectionConfig): DatabaseConnection {
  return new DatabaseConnection(config);
}
