import { describe, expect, it } from "vitest";

import { envErrorMessage, getServerEnv, missingPublicEnv } from "../env";
import { handleLogin, handleLogout } from "../handlers/auth";
import { handleHealth } from "../handlers/health";
import { handleProxy } from "../handlers/proxy";
import { readSession } from "../session";
import { API, MISSING, TOKEN, deps, fakeFetch, jsonRes, req } from "./helpers";

const cookie = `ap_session=${TOKEN}`;
const loginReq = (
  body: unknown = { email: "a@example.com", password: "test-only-password" }
) =>
  req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("env handling", () => {
  it("names the missing variable and never echoes values", () => {
    expect(getServerEnv({})).toEqual({ ok: false, missing: "API_BASE_URL" });
    expect(getServerEnv({ API_BASE_URL: "  " })).toEqual({
      ok: false,
      missing: "API_BASE_URL",
    });
    const bad = getServerEnv({ API_BASE_URL: "not a url test-only-value" });
    expect(bad).toEqual({ ok: false, missing: "API_BASE_URL", invalid: true });
    expect(JSON.stringify(bad)).not.toContain("test-only-value");
    expect(getServerEnv({ API_BASE_URL: "https://x.test.invalid//" })).toEqual({
      ok: true,
      apiBaseUrl: "https://x.test.invalid",
    });
    expect(envErrorMessage("API_BASE_URL")).toBe(
      "Missing required environment variable: API_BASE_URL"
    );
  });

  it("lists missing public variables by name", () => {
    expect(
      missingPublicEnv({ apiBaseUrl: null, agGridLicenseKey: null })
    ).toEqual(["NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_AG_GRID_LICENSE_KEY"]);
    expect(
      missingPublicEnv({ apiBaseUrl: "https://x", agGridLicenseKey: "k" })
    ).toEqual([]);
  });

  it("every handler returns 500 naming API_BASE_URL without calling fetch, and keeps serving", async () => {
    const f = fakeFetch(() => jsonRes({}));
    const d = deps(f.fn, MISSING);
    for (const res of [
      await handleHealth(req("/api/health"), d),
      await handleLogin(loginReq(), d),
      await handleProxy(req("/api/owner/agents", { cookie }), ["agents"], d),
    ]) {
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("API_BASE_URL");
    }
    expect(f.calls).toHaveLength(0);
    const ok = fakeFetch(() => jsonRes({ status: "ok" }));
    expect((await handleHealth(req("/api/health"), deps(ok.fn))).status).toBe(
      200
    );
  });
});

describe("GET /api/health", () => {
  it("2xx => 200 with upstream status and a body summary of at most 200 chars", async () => {
    const f = fakeFetch(() => new Response("x".repeat(500), { status: 200 }));
    const res = await handleHealth(req("/api/health"), deps(f.fn));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      upstreamStatus: number;
      body: string;
    };
    expect(body).toMatchObject({ ok: true, upstreamStatus: 200 });
    expect(body.body).toHaveLength(200);
    expect(f.calls[0]?.url).toBe(`${API}/healthz`);
  });

  it("non-2xx => 502 upstream_error; network error => 502 unreachable; timeout => 502 timeout", async () => {
    const down = await handleHealth(
      req("/api/health"),
      deps(fakeFetch(() => new Response("", { status: 503 })).fn)
    );
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({
      ok: false,
      reason: "upstream_error",
      upstreamStatus: 503,
    });

    const net = await handleHealth(
      req("/api/health"),
      deps(
        fakeFetch(() => {
          throw new TypeError("fetch failed");
        }).fn
      )
    );
    expect(await net.json()).toEqual({ ok: false, reason: "unreachable" });

    const slow = fakeFetch(() => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    });
    expect(
      await (await handleHealth(req("/api/health"), deps(slow.fn))).json()
    ).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("POST /api/auth/login", () => {
  const okLogin = () =>
    fakeFetch(() =>
      jsonRes({
        ownerId: "owner-1",
        accessToken: TOKEN,
        tokenType: "Bearer",
        expiresAt: "2030-01-01T01:00:00.000Z",
      })
    );

  it("sets an httpOnly, Secure, SameSite cookie and never returns the JWT", async () => {
    const f = okLogin();
    const res = await handleLogin(loginReq(), deps(f.fn));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^ap_session=/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Expires=Tue, 01 Jan 2030 01:00:00 GMT");
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      ownerId: "owner-1",
      expiresAt: "2030-01-01T01:00:00.000Z",
    });
    for (const [k, v] of res.headers)
      if (k !== "set-cookie") expect(v).not.toContain(TOKEN);
    expect(f.calls[0]?.url).toBe(`${API}/auth/login`);
  });

  it("rejected or failed login sets no cookie and stays generic", async () => {
    for (const status of [400, 401, 429, 500]) {
      const res = await handleLogin(
        loginReq(),
        deps(fakeFetch(() => jsonRes({ error: "unauthorized" }, status)).fn)
      );
      expect(res.status).toBe(status === 500 ? 502 : status);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const net = await handleLogin(
      loginReq(),
      deps(
        fakeFetch(() => {
          throw new TypeError("x");
        }).fn
      )
    );
    expect(net.status).toBe(502);
    expect(net.headers.get("set-cookie")).toBeNull();
    const bad = await handleLogin(
      loginReq(),
      deps(
        fakeFetch(() =>
          jsonRes({ ownerId: "o", accessToken: "has spaces", expiresAt: "x" })
        ).fn
      )
    );
    expect(bad.status).toBe(502);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("rejects bad bodies, non-JSON and cross-origin requests without calling the API", async () => {
    const f = okLogin();
    expect((await handleLogin(loginReq({ email: 1 }), deps(f.fn))).status).toBe(
      400
    );
    expect(
      (
        await handleLogin(
          req("/api/auth/login", { method: "POST", body: "email=a" }),
          deps(f.fn)
        )
      ).status
    ).toBe(415);
    const cross = req("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.test.invalid",
      },
      body: "{}",
    });
    expect((await handleLogin(cross, deps(f.fn))).status).toBe(403);
    expect(f.calls).toHaveLength(0);
  });

  it("logout expires the cookie", async () => {
    const res = handleLogout(req("/api/auth/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toMatch(/^ap_session=; .*Max-Age=0/);
    expect(readSession(req("/x", { cookie: "ap_session=" }))).toBeNull();
  });
});

describe("/api/owner/[...path] proxy", () => {
  it("forwards allowlisted calls with the cookie JWT as Bearer and passes status and body through", async () => {
    const f = fakeFetch(() => jsonRes({ agents: [] }));
    const res = await handleProxy(
      req("/api/owner/agents", { cookie }),
      ["agents"],
      deps(f.fn)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: [] });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(f.calls[0]?.url).toBe(`${API}/agents`);
    expect(new Headers(f.calls[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it("passes the query string only for owner/intents and forwards JSON bodies", async () => {
    const f = fakeFetch(() => jsonRes({ ok: true }));
    await handleProxy(
      req("/api/owner/owner/intents?state=escalated", { cookie }),
      ["owner", "intents"],
      deps(f.fn)
    );
    await handleProxy(
      req("/api/owner/owner/stats?x=1", { cookie }),
      ["owner", "stats"],
      deps(f.fn)
    );
    await handleProxy(
      req("/api/owner/agents/a1/policy", {
        method: "PUT",
        cookie,
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
      }),
      ["agents", "a1", "policy"],
      deps(f.fn)
    );
    expect(f.calls.map((c) => c.url)).toEqual([
      `${API}/owner/intents?state=escalated`,
      `${API}/owner/stats`,
      `${API}/agents/a1/policy`,
    ]);
    expect(f.calls[2]?.init.body).toBe('{"a":1}');
  });

  it("401 without cookie, 404 for unknown paths, 403 cross-origin, 415 non-JSON writes; none call the API", async () => {
    const f = fakeFetch(() => jsonRes({}));
    const d = deps(f.fn);
    expect(
      (await handleProxy(req("/api/owner/agents"), ["agents"], d)).status
    ).toBe(401);
    expect(
      (await handleProxy(req("/x", { cookie }), ["auth", "login"], d)).status
    ).toBe(404);
    expect(
      (await handleProxy(req("/x", { cookie }), ["agents", "..", "x"], d))
        .status
    ).toBe(404);
    expect(
      (
        await handleProxy(
          req("/x", { method: "DELETE", cookie }),
          ["agents"],
          d
        )
      ).status
    ).toBe(404);
    const cross = req("/x", {
      method: "POST",
      cookie,
      headers: {
        "content-type": "application/json",
        origin: "https://evil.test.invalid",
      },
      body: "{}",
    });
    expect((await handleProxy(cross, ["agents"], d)).status).toBe(403);
    expect(
      (
        await handleProxy(
          req("/x", { method: "POST", cookie, body: "a=b" }),
          ["agents"],
          d
        )
      ).status
    ).toBe(415);
    expect(f.calls).toHaveLength(0);
  });

  it("upstream 401 clears the session cookie; network failure => 502", async () => {
    const res = await handleProxy(
      req("/x", { cookie }),
      ["agents"],
      deps(fakeFetch(() => jsonRes({ error: "unauthorized" }, 401)).fn)
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    const net = await handleProxy(
      req("/x", { cookie }),
      ["agents"],
      deps(
        fakeFetch(() => {
          throw new TypeError("x");
        }).fn
      )
    );
    expect(net.status).toBe(502);
  });
});
