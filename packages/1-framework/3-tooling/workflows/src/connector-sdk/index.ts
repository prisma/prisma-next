export interface ConnectorAuthDefinition {
  readonly type: 'none' | 'apiKey' | 'oauth2' | 'basic';
  readonly secretRef?: string;
  readonly scopes?: readonly string[];
}

export interface ConnectorEventContext<EventPayload = unknown> {
  readonly rawBody?: string | Uint8Array;
  readonly headers: Record<string, string>;
  readonly event: EventPayload;
  readonly account?: { readonly id: string; readonly metadata?: unknown };
  readonly secrets: Record<string, string | undefined>;
}

export interface NormalizedConnectorEvent {
  readonly type: string;
  readonly externalId: string;
  readonly occurredAt?: Date;
  readonly subject?: string;
  readonly payload: unknown;
}

export interface ConnectorEventDefinition<EventPayload = unknown> {
  verify?(context: ConnectorEventContext<EventPayload>): Promise<boolean> | boolean;
  dedupeKey(context: ConnectorEventContext<EventPayload>): Promise<string> | string;
  normalize(
    context: ConnectorEventContext<EventPayload>,
  ): Promise<NormalizedConnectorEvent> | NormalizedConnectorEvent;
  readonly fixture?: EventPayload;
}

export interface ConnectorActionContext<Input = unknown> {
  readonly input: Input;
  readonly client?: unknown;
  readonly secrets: Record<string, string | undefined>;
  readonly idempotencyKey?: string;
}

export interface ConnectorActionDefinition<Input = unknown, Output = unknown> {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly rateLimit?: { readonly limit: number; readonly window: string };
  readonly idempotency?: string;
  run(context: ConnectorActionContext<Input>): Promise<Output> | Output;
}

export interface ConnectorSyncContext<Cursor = unknown> {
  readonly cursor?: Cursor;
  readonly client?: unknown;
  readonly secrets: Record<string, string | undefined>;
}

export interface ConnectorSyncDefinition<Cursor = unknown, Output = unknown> {
  readonly cursor: string;
  run(context: ConnectorSyncContext<Cursor>): Promise<Output> | Output;
}

export interface ConnectorDefinition {
  readonly id: string;
  readonly displayName?: string;
  readonly auth?: ConnectorAuthDefinition;
  readonly events?: Record<string, ConnectorEventDefinition>;
  readonly actions?: Record<string, ConnectorActionDefinition>;
  readonly syncs?: Record<string, ConnectorSyncDefinition>;
  readonly fixtures?: Record<string, unknown>;
  readonly ui?: Record<string, unknown>;
}

export interface ConnectorManifest {
  readonly kind: 'prisma-workflow-connector';
  readonly id: string;
  readonly displayName: string;
  readonly auth: ConnectorAuthDefinition;
  readonly events: readonly string[];
  readonly actions: readonly string[];
  readonly syncs: readonly string[];
  readonly fixtures: readonly string[];
  readonly mcpTools: readonly ConnectorMcpToolDescriptor[];
}

export interface ConnectorMcpToolDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export function defineConnector<const T extends ConnectorDefinition>(definition: T): T {
  return definition;
}

export function defineAuth(definition: ConnectorAuthDefinition): ConnectorAuthDefinition {
  return definition;
}

export function defineEvent<const T extends ConnectorEventDefinition>(definition: T): T {
  return definition;
}

export function defineAction<const T extends ConnectorActionDefinition>(definition: T): T {
  return definition;
}

export function defineSync<const T extends ConnectorSyncDefinition>(definition: T): T {
  return definition;
}

export function connectorManifest(definition: ConnectorDefinition): ConnectorManifest {
  const events = Object.keys(definition.events ?? {});
  const actions = Object.keys(definition.actions ?? {});
  const syncs = Object.keys(definition.syncs ?? {});
  const fixtures = Object.keys(definition.fixtures ?? {});
  return {
    kind: 'prisma-workflow-connector',
    id: definition.id,
    displayName: definition.displayName ?? definition.id,
    auth: definition.auth ?? { type: 'none' },
    events,
    actions,
    syncs,
    fixtures,
    mcpTools: connectorMcpTools(definition),
  };
}

export function connectorMcpTools(
  definition: ConnectorDefinition,
): readonly ConnectorMcpToolDescriptor[] {
  const tools: ConnectorMcpToolDescriptor[] = [];
  for (const eventName of Object.keys(definition.events ?? {})) {
    tools.push({
      name: `${definition.id}.event.${eventName}`,
      title: `${definition.displayName ?? definition.id} ${eventName}`,
      description: `Ingest ${eventName} events from ${definition.displayName ?? definition.id}.`,
      inputSchema: { type: 'object' },
    });
  }
  for (const actionName of Object.keys(definition.actions ?? {})) {
    tools.push({
      name: `${definition.id}.action.${actionName}`,
      title: `${definition.displayName ?? definition.id} ${actionName}`,
      description: `Run the ${actionName} action for ${definition.displayName ?? definition.id}.`,
      inputSchema: { type: 'object' },
    });
  }
  for (const syncName of Object.keys(definition.syncs ?? {})) {
    tools.push({
      name: `${definition.id}.sync.${syncName}`,
      title: `${definition.displayName ?? definition.id} ${syncName}`,
      description: `Run the ${syncName} sync for ${definition.displayName ?? definition.id}.`,
      inputSchema: { type: 'object' },
    });
  }
  return tools;
}
