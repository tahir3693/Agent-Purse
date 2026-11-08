import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { HttpAgentApi } from "../api.js";
import { pickOffer } from "../catalog.js";
import { parseArgs } from "../cli.js";
import { loadConfig } from "../config.js";
import { formatCents } from "../money.js";
import { Transcript, cap, redact } from "../transcript.js";
import { AGENT_KEY, CABLE, TOKEN, product, type OfferSpec } from "./stubs.js";

const FULL_ENV = {
  DEMO_AGENT_KEY: AGENT_KEY,
  DEMO_PAYMENT_METHOD_ID: "vm-test-1",
  CHANNEL3_API_KEY: "test-only-channel3-key-0123456789",
};

describe("config", () => {
  it("defaults the API URL and trims values", () => {
    const r = loadConfig({ ...FULL_ENV, DEMO_API_BASE_URL: "" });
    expect(r.ok && r.config.apiBaseUrl).toBe("http://localhost:8080");
    const r2 = loadConfig({
      ...FULL_ENV,
      DEMO_API_BASE_URL: "https://api.test.invalid//",
    });
    expect(r2.ok && r2.config.apiBaseUrl).toBe("https://api.test.invalid");
  });

  it.each(["DEMO_AGENT_KEY", "DEMO_PAYMENT_METHOD_ID", "CHANNEL3_API_KEY"])(
    "missing or empty %s names the variable and prints no values",
    (name) => {
      for (const value of [undefined, "", "   "]) {
        const r = loadConfig({ ...FULL_ENV, [name]: value });
        expect(r.ok).toBe(false);
        const msg = r.ok ? "" : r.message;
        expect(msg).toBe(`Missing required environment variable: ${name}`);
        for (const v of Object.values(FULL_ENV)) expect(msg).not.toContain(v);
      }
    }
  );

  it("rejects a credentialed or non-http DEMO_API_BASE_URL without echoing it", () => {
    for (const bad of [
      ["https://", "u", ":", "test-only-pw", "@h.test"].join(""),
      "ftp://h.test",
      "not a url",
    ]) {
      const r = loadConfig({ ...FULL_ENV, DEMO_API_BASE_URL: bad });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.message).toBe(
        "Invalid environment variable: DEMO_API_BASE_URL"
      );
    }
  });
});

describe("money and transcript", () => {
  it("formats integer cents without floats", () => {
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-250)).toBe("-$2.50");
    expect(formatCents(1.5)).toBe("(invalid amount)");
  });

  it("redacts tokens to an 8 character prefix and hides keys", () => {
    expect(redact(TOKEN)).toBe(`${TOKEN.slice(0, 8)}...`);
    const t = new Transcript(() => undefined);
    t.protect(AGENT_KEY, "hide");
    t.protect(TOKEN, "prefix");
    t.line(`key ${AGENT_KEY} token ${TOKEN}`);
    expect(t.text()).toBe(`key [redacted] token ${TOKEN.slice(0, 8)}...`);
  });

  it("caps and strips control characters from untrusted text", () => {
    expect(cap("a\u001b[31mred\nline")).toBe("a [31mred line");
    expect(cap("x".repeat(300))).toHaveLength(203);
    expect(cap(undefined)).toBe("");
  });

  // Feature: spec-11a-demo-agent, Property 1: transcript never leaks secrets
  it("Property 1: protected values never appear in full in any line", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (before, after) => {
          const t = new Transcript(() => undefined);
          t.protect(AGENT_KEY, "hide");
          t.protect(TOKEN, "prefix");
          t.line(`${before}${AGENT_KEY}${after}${TOKEN}${before}`);
          expect(t.text()).not.toContain(AGENT_KEY);
          expect(t.text()).not.toContain(TOKEN);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("pickOffer", () => {
  it("picks the cheapest in-stock USD offer within budget", () => {
    expect(pickOffer([CABLE], 2500)).toMatchObject({
      productId: "prod-cable",
      domain: "shop-b.test",
      priceCents: 999,
    });
  });

  it("returns null when nothing in stock fits the budget", () => {
    const p = product("p", [
      ["a.test", 30],
      ["b.test", 5, "OutOfStock"],
      ["c.test", 4, "InStock", "EUR"],
    ]);
    expect(pickOffer([p], 2500)).toBeNull();
    expect(pickOffer([], 2500)).toBeNull();
  });

  // Feature: spec-11a-demo-agent, Property 2: offer selection is minimal
  it("Property 2: result is the minimum in-stock USD offer <= budget, ties by first position", () => {
    const offerArb = fc.tuple(
      fc.constantFrom("a.test", "b.test", "c.test"),
      fc.integer({ min: 1, max: 50_000 }),
      fc.constantFrom<"InStock" | "OutOfStock">("InStock", "OutOfStock"),
      fc.constantFrom("USD", "EUR")
    );
    fc.assert(
      fc.property(
        fc.array(fc.array(offerArb, { maxLength: 4 }), { maxLength: 4 }),
        fc.integer({ min: 1, max: 60_000 }),
        (lists, budget) => {
          const products = lists.map((offers, i) =>
            product(
              `p${i}`,
              offers.map(
                ([d, cents, a, c]) => [d, cents / 100, a, c] as OfferSpec
              )
            )
          );
          const eligible = lists.flatMap((offers, i) =>
            offers
              .filter(
                ([, cents, a, c]) =>
                  a === "InStock" && c === "USD" && cents <= budget
              )
              .map(([d, cents]) => ({ i, d, cents }))
          );
          const r = pickOffer(products, budget);
          if (eligible.length === 0) {
            expect(r).toBeNull();
            return;
          }
          const min = Math.min(...eligible.map((e) => e.cents));
          const first = eligible.find((e) => e.cents === min)!;
          expect(r).toMatchObject({
            priceCents: min,
            productId: `p${first.i}`,
            domain: first.d,
          });
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe("CLI args", () => {
  it("parses a name, all, and the = form", () => {
    expect(parseArgs(["--scenario", "replay"])).toEqual({
      ok: true,
      names: ["replay"],
    });
    expect(parseArgs(["--scenario=over-cap"])).toEqual({
      ok: true,
      names: ["over-cap"],
    });
    const all = parseArgs(["--scenario", "all"]);
    expect(all.ok && all.names).toEqual([
      "small-safe",
      "needs-approval",
      "over-cap",
      "overpriced",
      "injection",
      "replay",
    ]);
  });

  it("missing or unknown names list the valid ones", () => {
    for (const argv of [[], ["--scenario"], ["--scenario", "nope"]]) {
      const r = parseArgs(argv);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.message).toContain(
        "small-safe|needs-approval|over-cap|overpriced|injection|replay|all"
      );
    }
  });
});

describe("HttpAgentApi", () => {
  it("sends the Bearer key, maps network errors, and never throws on HTTP errors", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ error: "conflict" }), {
        status: 409,
      });
    }) as typeof fetch;
    const api = new HttpAgentApi("https://api.test.invalid", AGENT_KEY, fake);
    const r = await api.execute("int 1", TOKEN);
    expect(r).toEqual({ status: 409, body: { error: "conflict" } });
    expect(seen[0]).toEqual({
      url: "https://api.test.invalid/intents/int%201/execute",
      auth: `Bearer ${AGENT_KEY}`,
    });
    const down = new HttpAgentApi(
      "https://api.test.invalid",
      AGENT_KEY,
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch
    );
    expect(await down.getIntent("x")).toEqual({
      status: 0,
      body: {},
      networkError: "unreachable",
    });
  });
});
