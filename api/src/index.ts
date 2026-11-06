import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { createPaymentProvider } from "./payments/factory.js";
import type { PaymentProvider } from "./payments/types.js";

async function main(): Promise<void> {
  let paymentProvider: PaymentProvider;
  try {
    paymentProvider = createPaymentProvider(process.env);
  } catch (err) {
    // Config errors name the variable only, never a value.
    const message = err instanceof Error ? err.message : "Invalid payments configuration";
    console.error(message);
    process.exit(1);
  }

  const app = buildServer({ paymentProvider });
  const { host, port } = loadConfig();
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, `failed to bind on ${host}:${port}`);
    process.exit(1);
  }
}

void main();
