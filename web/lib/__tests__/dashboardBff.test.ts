// spec-09a BFF additions: register, link test card, proxy key scrub. Offline.
import { describe, expect, it } from "vitest";

import {
  ALLOWLIST,
  handleProxy,
  isAllowed,
  scrubApiKeys,
} from "../handlers/proxy";
import { REGISTER_MESSAGES, handleRegister } from "../handlers/register";
import {
  SANDBOX_TEST_NONCE,
  handleLinkTestCard,
  subjectOf,
} from "../handlers/linkTestCard";
import { API, MISSING, deps, fakeFetch, jsonRes, req } from "./helpers";

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "owner-test-1" })}.test-only-signature`;
const cookie = `ap_session=${JWT}`;
const PASSWORD = "test-only-password-123";
const regReq = (body: unknown) =>
  req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/register", () => {
  it("201 => ok, never sets a cookie, forwards email and password", async () => {
    const f = fakeFetch(() =>
      jsonRes({ ownerId: "o1", email: "a@b.test" }, 201)
    );
    const res = await handleRegister(
      regReq({ email: "a@b.test", password: PASSWORD }),
      deps(f.fn)
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(f.calls[0]?.url).toBe(`${API}/auth/register`);
  });

  it("maps 409, 400 fields, 429 and failures to distinct messages", async () => {
    const run = async (status: number, body: unknown = {}) =>
      (
        await handleRegister(
          regReq({ email: "a@b.test", password: PASSWORD }),
          deps(fakeFetch(() => jsonRes(body, status)).fn)
        )
      ).json();
    expect(await run(409, { error: "email_taken" })).toMatchObject({
      error: REGISTER_MESSAGES.emailTaken,
      code: "email_taken",
    });
    expect(
      await run(400, { error: "invalid_body", fields: ["password"] })
    ).toMatchObject({
      error: REGISTER_MESSAGES.invalid,
      fields: { password: "Use 12 to 256 characters" },
    });
    expect(await run(429)).toMatchObject({
      error: REGISTER_MESSAGES.rateLimited,
    });
    expect(await run(500)).toMatchObject({
      error: REGISTER_MESSAGES.unavailable,
    });
    const net = await handleRegister(
      regReq({ email: "a@b.test", password: PASSWORD }),
      deps(
        fakeFetch(() => {
          throw new TypeError("x");
        }).fn
      )
    );
    expect(net.status).toBe(502);
  });

  it("validates locally (short password) without calling the API; missing env names the variable", async () => {
    const f = fakeFetch(() => jsonRes({}, 201));
    const res = await handleRegister(
      regReq({ email: "a@b.test", password: "short" }),
      deps(f.fn)
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      fields: { password: "Use 12 to 256 characters" },
    });
    expect(f.calls).toHaveLength(0);
    const m = await handleRegister(
      regReq({ email: "a@b.test", password: PASSWORD }),
      deps(f.fn, MISSING)
    );
    expect(await m.text()).toContain("API_BASE_URL");
  });
});

describe("POST /api/vault/link-test-card", () => {
  const linkReq = (c: string | null = cookie) =>
    req("/api/vault/link-test-card", { method: "POST", cookie: c });

  it("401 without a session and never calls the API", async () => {
    const f = fakeFetch(() => jsonRes({}));
    expect((await handleLinkTestCard(linkReq(null), deps(f.fn))).status).toBe(
      401
    );
    expect(f.calls).toHaveLength(0);
  });

  it("sends the fixed sandbox nonce and ownerId from the token subject with the Bearer token", async () => {
    const f = fakeFetch(() =>
      jsonRes(
        {
          method: {
            id: "vm1",
            cardType: "Visa",
            last4: "1111",
            tokenRef: "****abcd",
          },
        },
        201
      )
    );
    const res = await handleLinkTestCard(linkReq(), deps(f.fn));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      method: {
        id: "vm1",
        cardType: "Visa",
        last4: "1111",
        tokenRef: "****abcd",
      },
    });
    expect(f.calls[0]?.url).toBe(`${API}/vault/link`);
    expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({
      ownerId: "owner-test-1",
      nonce: SANDBOX_TEST_NONCE,
    });
    expect(new Headers(f.calls[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${JWT}`
    );
    expect(subjectOf("not-a-jwt")).toBeNull();
  });

  it("maps upstream errors and clears the cookie on 401", async () => {
    const rej = await handleLinkTestCard(
      linkReq(),
      deps(
        fakeFetch(() =>
          jsonRes(
            {
              error: "payment_method_rejected",
              message: "Payment method was rejected",
            },
            422
          )
        ).fn
      )
    );
    expect(rej.status).toBe(422);
    expect(await rej.json()).toEqual({
      error: "payment_method_rejected",
      message: "Payment method was rejected",
    });
    const expired = await handleLinkTestCard(
      linkReq(),
      deps(fakeFetch(() => jsonRes({ error: "unauthorized" }, 401)).fn)
    );
    expect(expired.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("proxy changes", () => {
  it("vault/link is no longer reachable through the generic proxy", () => {
    expect(isAllowed("POST", ["vault", "link"])).toBe(false);
    expect(Object.values(ALLOWLIST).flat().map(String).join(" ")).not.toContain(
      "vault\\/link"
    );
  });

  it("agent API key is passed through only on POST agents and scrubbed everywhere else", async () => {
    const created = await handleProxy(
      req("/x", {
        method: "POST",
        cookie,
        headers: { "content-type": "application/json" },
        body: '{"name":"bot"}',
      }),
      ["agents"],
      deps(
        fakeFetch(() =>
          jsonRes(
            { agent: { id: "a1" }, apiKey: "agk_test-only-key-once" },
            201
          )
        ).fn
      )
    );
    expect(await created.json()).toMatchObject({
      apiKey: "agk_test-only-key-once",
    });

    const listed = await handleProxy(
      req("/x", { cookie }),
      ["agents"],
      deps(
        fakeFetch(() =>
          jsonRes({
            agents: [
              { id: "a1", name: "bot", apiKey: "agk_test-only-key-once" },
            ],
          })
        ).fn
      )
    );
    const text = await listed.text();
    expect(text).not.toContain("agk_test-only-key-once");
    expect(JSON.parse(text)).toEqual({ agents: [{ id: "a1", name: "bot" }] });
    expect(scrubApiKeys("not json apiKey")).toBe("not json apiKey");
  });
});
