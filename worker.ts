import type { WorkerRegistration } from '../application';
import { createOpenCodeRuntime } from './src/runtime.ts';

export const registration = {
  runtime: {
    mount(context) {
      return createOpenCodeRuntime(context);
    },
  },
} satisfies WorkerRegistration;
