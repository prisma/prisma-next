import { createOnboardingWorkflowHandlers } from '../handlers';
import { createMockOnboardingProviders } from '../mock-providers';

const handlers = createOnboardingWorkflowHandlers(createMockOnboardingProviders());
const handler = handlers['scoreRisk'];
if (!handler) {
  throw new Error('Missing scoreRisk workflow handler.');
}

export default handler;
