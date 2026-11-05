import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./server.js";

// Unit tests for the health handler (Requirements 3.2, 3.3, 3.4).
// Uses Fastify `inject()` so no real socket is bound — the server is exercised
// entirely in-process.
describe("buildServer /healthz", () => {
  let app: ReturnType<typeof buildServer> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("responds 200 with body { status: 'ok' } for GET /healthz", async () => {
    app = buildServer();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns JSON content type for the health response", async () => {
    app = buildServer();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.headers["content-type"]).toContain("application/json");
  });
});
