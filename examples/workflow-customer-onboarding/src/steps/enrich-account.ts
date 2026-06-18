import { createOnboardingWorkflowHandlers } from '../handlers';
import { createMockOnboardingProviders } from '../mock-providers';

const handlers = createOnboardingWorkflowHandlers(createMockOnboardingProviders());
const handler = handlers['enrichAccount'];
if (!handler) {
  throw new Error('Missing enrichAccount workflow handler.');
}

export default handler;
