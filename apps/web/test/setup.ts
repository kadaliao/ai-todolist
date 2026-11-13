// Engines without native Temporal (Node < 26, Hermes, older Safari) need the polyfill, exactly
// like the apps will load it. FORCE_TEMPORAL_POLYFILL=1 runs the suite on the polyfill even on
// engines that have it natively, to check core doesn't depend on native-only behaviour.
if (process.env.FORCE_TEMPORAL_POLYFILL) {
  delete (globalThis as { Temporal?: unknown }).Temporal;
}
if (!(globalThis as { Temporal?: unknown }).Temporal) {
  await import('temporal-polyfill/global');
}

export {};
