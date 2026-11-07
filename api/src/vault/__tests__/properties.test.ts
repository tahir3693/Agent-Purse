import fc from "fast-check";
import { describe, it } from "vitest";
import { expect } from "vitest";

import { createMemoryAuditStore, createMemoryVaultStore } from "../../db/memory.js";
import type { VaultMethodRecord } from "../../db/stores.js";
import { ProviderError } from "../../payments/errors.js";
import type { PaymentProvider } from "../../payments/types.js";
import { linkMethod, toRedacted } from "../service.js";

const RUNS = { numRuns: 100 };

// Feature: spec-06-vault-linking, Property 1: Responses never contain secrets
// **Validates: Requirements 3.2, 3.3**
describe("Property 1: redacted output never contains secrets", () => {
  it("has exactly the five keys and omits raw token and customerId", () => {
    // Distinct prefixes guarantee the token/customerId are not substrings of other fields.
    const tokenArb = fc
      .string({ minLength: 8, maxLength: 40, unit: "grapheme-ascii" })
      .map((s) => `T~${s}~tok`);
    const customerArb = fc
      .string({ minLength: 8, maxLength: 40, unit: "grapheme-ascii" })
      .map((s) => `C~${s}~cus`);
    fc.assert(
      fc.property(
        tokenArb,
        customerArb,
        fc.option(fc.constantFrom("Visa", "MasterCard", "Amex"), { nil: null }),
        fc.option(fc.stringMatching(/^[0-9]{4}$/), { nil: null }),
        (token, customerId, cardType, last4) => {
          const record: VaultMethodRecord = {
            id: "11111111-1111-4111-8111-111111111111",
            ownerId: "owner",
            customerId,
            token,
            cardType,
            last4,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          };
          const out = toRedacted(record);
          expect(Object.keys(out).sort()).toEqual([
            "cardType",
            "createdAt",
            "id",
            "last4",
            "tokenRef",
          ]);
          const json = JSON.stringify(out);
          expect(json).not.toContain(token);
          expect(json).not.toContain(customerId);
          expect(out.tokenRef).toBe(`****${token.slice(-4)}`);
        },
      ),
      RUNS,
    );
  });
});

// Feature: spec-06-vault-linking, Property 2: Failure leaves no records
// **Validates: Requirements 2.1**
describe("Property 2: provider failure leaves no records", () => {
  const failureArb = fc.oneof(
    fc
      .tuple(
        fc.constantFrom("invalid_request", "rejected", "declined", "provider_error", "not_found"),
        fc.string({ maxLength: 30 }),
      )
      .map(([code, message]) => new ProviderError({ provider: "braintree", code, message })),
    fc.string({ maxLength: 30 }).map((m) => new Error(m)),
    fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.constant(null)),
  );

  it("store holds zero records after any provider failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        failureArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        async (failure, ownerId, nonce) => {
          const vault = createMemoryVaultStore();
          const audit = createMemoryAuditStore();
          const provider = {
            async linkPaymentMethod() {
              throw failure;
            },
          } as unknown as PaymentProvider;

          const err = await linkMethod({ vault, audit, provider }, ownerId, {
            ownerId,
            nonce,
          }).catch((e: unknown) => e);

          expect(err).toBeInstanceOf(Error);
          expect([422, 502]).toContain((err as { status: number }).status);
          expect(await vault.listByOwner(ownerId)).toHaveLength(0);
          expect(await vault.findByOwnerAndToken(ownerId, "anything")).toBeNull();
        },
      ),
      RUNS,
    );
  });
});
