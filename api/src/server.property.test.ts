import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildServer } from "./server.js";

// Feature: agentpurse-scaffold, Property 1: Health endpoint returns the healthy contract
//
// For any number of GET /healthz requests against a freshly built server, each
// response has HTTP status 200 and a JSON body deep-equal to { "status": "ok" }.
// The endpoint takes no input, so the universal quantifier ranges over the number
// of requests issued against the server. Exercised via Fastify inject() (no socket
// bind), so it is fast and isolated and may be repeated at high iteration counts.
//
// Validates: Requirements 3.2, 3.3, 3.4, 9.3
describe("Property 1: Health endpoint returns the healthy contract", () => {
  it("returns 200 and { status: 'ok' } for every GET /healthz request", async () => {
    const app = buildServer();
    await app.ready();
    try {
      await fc.assert(
        fc.asyncProperty(fc.constant(null), async () => {
          const response = await app.inject({
            method: "GET",
            url: "/healthz",
          });

          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual({ status: "ok" });
        }),
        { numRuns: 100 },
      );
    } finally {
      await app.close();
    }
  });
});
