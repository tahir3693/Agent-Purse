export { authenticateOwner, verifyOwnerToken } from "./auth.js";
export type { OwnerClaims, OwnerVerifyResult } from "./auth.js";
export { registerVaultRoutes, type VaultRoutesDeps } from "./routes.js";
export { LinkMethodBodySchema, type LinkMethodBody } from "./schema.js";
export {
  linkMethod,
  listMethods,
  toRedacted,
  VaultServiceError,
  VaultValidationError,
  type RedactedMethod,
  type VaultDeps,
} from "./service.js";
