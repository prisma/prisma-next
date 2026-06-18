export interface MockDisputeProviders {
  readonly hubspot: {
    customerHistory(customerId: string): Promise<Record<string, unknown>>;
  };
  readonly shopify: {
    orderHistory(customerId: string): Promise<readonly Record<string, unknown>[]>;
  };
  readonly zendesk: {
    priorTickets(customerId: string): Promise<readonly Record<string, unknown>[]>;
  };
  readonly stripe: {
    paymentMetadata(disputeId: string): Promise<Record<string, unknown>>;
    submitEvidence(input: {
      readonly disputeId: string;
      readonly response: string;
    }): Promise<{ readonly evidenceId: string }>;
  };
  readonly slack: {
    postSummary(
      input: Record<string, unknown>,
    ): Promise<{ readonly channel: string; readonly ts: string }>;
  };
}

export function createMockDisputeProviders(): MockDisputeProviders {
  return {
    hubspot: {
      async customerHistory(customerId) {
        return {
          customerId,
          lifecycleStage: 'customer',
          company: 'Acme Supplies',
          previousDisputes: 0,
          accountAgeDays: 940,
        };
      },
    },
    shopify: {
      async orderHistory(customerId) {
        return [
          {
            customerId,
            orderId: 'ord_1001',
            fulfilledAt: '2026-06-08T12:10:00.000Z',
            carrier: 'UPS',
            trackingNumber: '1ZMOCKTRACK',
          },
        ];
      },
    },
    zendesk: {
      async priorTickets(customerId) {
        return [
          {
            customerId,
            ticketId: 'zd_991',
            subject: 'Where is my receipt?',
            status: 'solved',
          },
        ];
      },
    },
    stripe: {
      async paymentMetadata(disputeId) {
        return {
          disputeId,
          chargeId: 'ch_001',
          receiptEmail: 'billing@acme.example',
          cardFingerprint: 'fp_mock_001',
        };
      },
      async submitEvidence(input) {
        return {
          evidenceId: `evidence_${input.disputeId}`,
        };
      },
    },
    slack: {
      async postSummary() {
        return { channel: '#disputes', ts: '1781539000.000100' };
      },
    },
  };
}
