import type { SurfaceRegistration } from '../application';
import { mountRuntimeStatus } from './src/status-view.ts';

export const registration = {
  configuration: {
    mount(context) {
      mountRuntimeStatus(context, { signInCommand: 'opencode auth login' });
    },
  },
} satisfies SurfaceRegistration;
