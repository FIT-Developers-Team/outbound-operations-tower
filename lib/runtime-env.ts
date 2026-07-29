declare global {
  // Runtime bindings are attached by the Worker entry before Vinext handles a
  // request. A global keeps this helper synchronous for validation code.
  var __OUTBOUND_RUNTIME_ENV__: Record<string, unknown> | undefined;
}

export function setRuntimeEnvBindings(bindings: Record<string, unknown>) {
  globalThis.__OUTBOUND_RUNTIME_ENV__ = bindings;
}

/**
 * Cloudflare runtime variables are bindings, while Node/Vite tests expose
 * process.env. Read both so production, Wrangler local, and tests behave alike.
 */
export function runtimeEnv(name: string): string | undefined {
  const binding = globalThis.__OUTBOUND_RUNTIME_ENV__?.[name];
  if (typeof binding === "string") return binding;
  return process.env[name];
}

export function runtimeFlag(name: string) {
  return runtimeEnv(name)?.trim().toLowerCase() === "true";
}
