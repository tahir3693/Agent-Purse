import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { handleLogin } from "../handlers/auth";
import { BODY_SUMMARY_MAX, handleHealth } from "../handlers/health";
import { ALLOWLIST, handleProxy, isAllowed } from "../handlers/proxy";
import { deps, fakeFetch, jsonRes, req } from "./helpers";

const tokenArb = fc.stringMatching(
  /^[A-Za-z0-9_-]{8,40}\.[A-Za-z0-9_-]{8,40}\.[A-Za-z0-9_-]{8,40}$/
);
const segArb = fc.oneof(
  fc.constantFrom(
    "agents",
    "owner",
    "intents",
    "stats",
    "policy",
    "kill",
    "restore",
    "approve",
    "deny",
    "events",
    "token",
    "vault",
    "methods",
    "link",
    "auth",
    "login",
    "a1",
    "..",
    "",
    "x y"
  ),
  fc.string({ maxLength: 12 })
);
const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");

describe("Feature: spec-04-web-to-nextjs, Property 1: proxy gate", () => {
  it("fetch is called only for allowlisted paths with a cookie, and then carries the Bearer JWT", async () => {
    await fc.assert(
      fc.asyncProperty(
        methodArb,
        fc.array(segArb, { maxLength: 5 }),
        fc.option(tokenArb, { nil: null }),
        async (method, segs, token) => {
          const f = fakeFetch(() => jsonRes({ ok: true }));
          const hasBody = method !== "GET";
          const r = req("/api/owner/x", {
            method,
            cookie: token ? `ap_session=${token}` : null,
            headers: hasBody ? { "content-type": "application/json" } : {},
            body: hasBody ? "{}" : undefined,
          });
          const res = await handleProxy(r, segs, deps(f.fn));
          const allowed = isAllowed(method, segs);
          if (!token) expect(res.status).toBe(401);
          else if (!allowed) expect(res.status).toBe(404);
          if (token && allowed) {
            expect(f.calls).toHaveLength(1);
            expect(
              new Headers(f.calls[0]!.init.headers).get("authorization")
            ).toBe(`Bearer ${token}`);
          } else {
            expect(f.calls).toHaveLength(0);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("the allowlist only contains owner-scoped API paths (never auth/login, webhooks or agent intent routes)", () => {
    const all = Object.values(ALLOWLIST).flat().map(String).join(" ");
    expect(all).not.toMatch(/auth|webhook|execute|mandate|assistant/);
  });
});

describe("Feature: spec-04-web-to-nextjs, Property 2: JWT never leaves in a body", () => {
  it("login response body and non-cookie headers never contain the JWT", async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.dictionary(
          fc.string({ maxLength: 8 }),
          fc.string({ maxLength: 20 })
        ),
        async (token, extra) => {
          const f = fakeFetch(() =>
            jsonRes({
              ...extra,
              ownerId: "owner-1",
              accessToken: token,
              expiresAt: "2030-01-01T00:00:00.000Z",
            })
          );
          const res = await handleLogin(
            req("/api/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: '{"email":"a@b.c","password":"p"}',
            }),
            deps(f.fn)
          );
          expect(await res.text()).not.toContain(token);
          for (const [k, v] of res.headers)
            if (k !== "set-cookie") expect(v).not.toContain(token);
          expect(res.headers.get("set-cookie")).toContain("HttpOnly");
        }
      ),
      { numRuns: 150 }
    );
  });

  it("proxy responses never add the JWT to the body", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, fc.json(), async (token, upstream) => {
        fc.pre(!upstream.includes(token));
        const f = fakeFetch(
          () =>
            new Response(upstream, {
              status: 200,
              headers: { "content-type": "application/json" },
            })
        );
        const res = await handleProxy(
          req("/x", { cookie: `ap_session=${token}` }),
          ["owner", "stats"],
          deps(f.fn)
        );
        expect(await res.text()).not.toContain(token);
      }),
      { numRuns: 150 }
    );
  });
});

describe("Feature: spec-04-web-to-nextjs, Property 3: health mapping", () => {
  it("2xx => 200 with a body of at most 200 chars; otherwise 502 with the upstream status", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 200, max: 599 }),
        fc.string({ maxLength: 600 }),
        async (status, body) => {
          const f = fakeFetch(
            () =>
              new Response([204, 205, 304].includes(status) ? null : body, {
                status,
              })
          );
          const res = await handleHealth(req("/api/health"), deps(f.fn));
          const out = (await res.json()) as {
            body?: string;
            upstreamStatus?: number;
          };
          if (status < 300) {
            expect(res.status).toBe(200);
            expect((out.body ?? "").length).toBeLessThanOrEqual(
              BODY_SUMMARY_MAX
            );
          } else {
            expect(res.status).toBe(502);
            expect(out.upstreamStatus).toBe(status);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
