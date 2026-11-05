import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const app = buildServer();
  const { host, port } = loadConfig();
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err, `failed to bind on ${host}:${port}`);
    process.exit(1);
  }
}

void main();
