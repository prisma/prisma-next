import { createOnboardingWorkflowHandlers } from '../handlers';
import { createMockOnboardingProviders } from '../mock-providers';

const handlers = createOnboardingWorkflowHandlers(createMockOnboardingProviders());
const handler = handlers['provisionWorkspace'];
if (!handler) {
  throw new Error('Missing provisionWorkspace workflow handler.');
}

export default handler;
