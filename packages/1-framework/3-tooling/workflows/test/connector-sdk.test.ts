import { describe, expect, it } from 'vitest';
import {
  connectorManifest,
  defineAction,
  defineConnector,
  defineEvent,
  defineSync,
} from '../src/connector-sdk';

describe('connector SDK', () => {
  it('defines event, action, sync, fixture, and MCP metadata', async () => {
    const stripe = defineConnector({
      id: 'stripe',
      displayName: 'Stripe',
      auth: { type: 'apiKey', secretRef: 'STRIPE_SECRET_KEY' },
      events: {
        'charge.dispute.created': defineEvent({
          dedupeKey: ({ event }) => `stripe:${recordValue(event)['id']}`,
          normalize: ({ event }) => ({
            type: 'charge.dispute.created',
            externalId: String(recordValue(event)['id']),
            subject: String(recordValue(recordValue(event)['data'])['object']),
            payload: event,
          }),
        }),
      },
      actions: {
        submitDisputeEvidence: defineAction({
          idempotency: 'input.idempotencyKey',
          run: ({ input }) => ({ ok: true, input }),
        }),
      },
      syncs: {
        disputes: defineSync({
          cursor: 'updated',
          run: ({ cursor }) => ({ cursor }),
        }),
      },
      fixtures: {
        disputeCreated: { id: 'evt_123' },
      },
    });

    const manifest = connectorManifest(stripe);

    expect(manifest).toMatchObject({
      kind: 'prisma-workflow-connector',
      id: 'stripe',
      displayName: 'Stripe',
      events: ['charge.dispute.created'],
      actions: ['submitDisputeEvidence'],
      syncs: ['disputes'],
      fixtures: ['disputeCreated'],
    });
    expect(manifest.mcpTools.map((tool) => tool.name)).toEqual([
      'stripe.event.charge.dispute.created',
      'stripe.action.submitDisputeEvidence',
      'stripe.sync.disputes',
    ]);
  });
});

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
