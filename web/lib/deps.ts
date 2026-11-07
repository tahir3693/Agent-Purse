// Production dependencies for the BFF handlers (server only).
import { getServerEnv } from "./env";
import type { Deps } from "./http";

export const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  env: () => getServerEnv(),
};
