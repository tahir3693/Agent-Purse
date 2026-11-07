// pnpm seed:demo. Loads the root .env (via node --env-file-if-exists). Prints
// the demo login and the agent key once. Never prints env values or the
// provider token; errors are reported by name/code only.

import {
  createPrismaAgentAdminStore,
  createPrismaAuditStore,
  createPrismaClient,
  createPrismaOwnerStore,
  createPrismaVaultStore,
} from "../db/prisma.js";
import { createPaymentProvider } from "../payments/factory.js";
import { seedDemo } from "./demo.js";

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]?.trim()) {
    console.error("Missing required environment variable: DATABASE_URL");
    process.exit(1);
  }
  let provider;
  try {
    provider = createPaymentProvider(process.env);
  } catch (err) {
    // Factory messages name variables only.
    console.error(err instanceof Error ? err.message : "Invalid payment configuration");
    process.exit(1);
  }
  const db = createPrismaClient();
  try {
    const r = await seedDemo({
      owners: createPrismaOwnerStore(db),
      agents: createPrismaAgentAdminStore(db),
      vault: createPrismaVaultStore(db),
      audit: createPrismaAuditStore(db),
      provider,
    });
    console.log("Demo data seeded. Shown once; store these now.");
    console.log(`  owner email:      ${r.email}`);
    console.log(
      r.password
        ? `  owner password:   ${r.password}`
        : "  owner password:   (owner already existed; password unchanged)",
    );
    console.log(`  agent id:         ${r.agentId}`);
    console.log(`  agent API key:    ${r.apiKey}`);
    console.log(`  vault method id:  ${r.vaultMethodId}  (use as paymentMethodRef)`);
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    const name = err instanceof Error ? err.name : "Error";
    console.error(`Seed failed: ${name}${typeof code === "string" ? ` (${code})` : ""}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();