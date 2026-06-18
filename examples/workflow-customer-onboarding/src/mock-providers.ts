export interface MockOnboardingProviders {
  readonly crm: {
    findAccount(domain: string): Promise<Record<string, unknown>>;
  };
  readonly billing: {
    profile(accountId: string): Promise<Record<string, unknown>>;
  };
  readonly identity: {
    signals(domain: string): Promise<Record<string, unknown>>;
  };
  readonly provisioning: {
    createWorkspace(accountId: string): Promise<Record<string, unknown>>;
  };
  readonly slack: {
    post(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

export function createMockOnboardingProviders(): MockOnboardingProviders {
  return {
    crm: {
      async findAccount(domain) {
        return {
          domain,
          owner: 'sales-ops@example.com',
          segment: 'enterprise',
          openOpportunities: 2,
        };
      },
    },
    billing: {
      async profile(accountId) {
        return {
          accountId,
          plan: 'enterprise',
          annualContractValue: 180000,
          paymentVerified: true,
        };
      },
    },
    identity: {
      async signals(domain) {
        return {
          domain,
          disposableEmail: false,
          sanctionedRegion: false,
          seatRequestSpike: true,
        };
      },
    },
    provisioning: {
      async createWorkspace(accountId) {
        return {
          workspaceId: `workspace_${accountId}`,
          region: 'us-east-1',
          defaultRolesCreated: true,
        };
      },
    },
    slack: {
      async post(input) {
        return {
          channel: '#onboarding',
          ts: '1781539200.000200',
          text: `Provisioned ${String(input['accountId'])}`,
        };
      },
    },
  };
}
