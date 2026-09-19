/// <reference types="vite/client" />

import type { MachineApi } from '../shared/types';

declare global {
  interface Window {
    /** Exposed by src/preload/preload.ts - the ONLY bridge to the main process. */
    machine: MachineApi;
  }
}

export {};
