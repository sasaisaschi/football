/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // The simulation runs in a module worker (sim/sim-worker.ts) with the physics chunk split off.
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    // Rapier ships its WASM inlined in the compat build; one large physics chunk is expected.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: id => (id.includes('@dimforge') ? 'physics' : id.includes('three') ? 'three' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
