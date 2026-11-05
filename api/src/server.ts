import Fastify, { type FastifyInstance } from "fastify";

export interface HealthResponse {
  status: "ok";
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.get("/healthz", async (): Promise<HealthResponse> => {
    return { status: "ok" };
  });
  return app;
}
