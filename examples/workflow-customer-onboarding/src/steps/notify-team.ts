import { createOnboardingWorkflowHandlers } from '../handlers';
import { createMockOnboardingProviders } from '../mock-providers';

const handlers = createOnboardingWorkflowHandlers(createMockOnboardingProviders());
const handler = handlers['notifyTeam'];
if (!handler) {
  throw new Error('Missing notifyTeam workflow handler.');
}

export default handler;
