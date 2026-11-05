// Recorded-shape PayPal JSON fixtures (no secrets, no live calls).
//
// These mirror the fields createHttpPayPalClient / verifyWebhook / the OAuth
// token cache actually read. Every value here is synthetic: ids are "ORDER-1"
// etc. and the only token-shaped string ("fake-token-xyz") is an obvious
// placeholder, never a real secret.

/** POST /v2/checkout/orders -> created order with a payer-action approval link. */
export const orderCreateResponse = {
  id: "ORDER-1",
  status: "CREATED",
  links: [
    {
      rel: "payer-action",
      href: "https://sandbox.paypal.com/approve/ORDER-1",
    },
    { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1" },
  ],
};

/** The payer approval URL expected to be surfaced as CreatedOrder.approvalUrl. */
export const approvalUrl = "https://sandbox.paypal.com/approve/ORDER-1";

/** POST /v2/checkout/orders/{id}/authorize -> one authorization. */
export const authorizeResponse = {
  purchase_units: [
    {
      payments: {
        authorizations: [{ id: "AUTH-1", status: "CREATED" }],
      },
    },
  ],
};

/** POST /v2/payments/authorizations/{id}/capture -> completed capture. */
export const captureResponse = {
  id: "CAP-1",
  status: "COMPLETED",
};

/** GET /v2/checkout/orders/{id} -> approved order (payer has approved). */
export const getOrderResponse = {
  id: "ORDER-1",
  status: "APPROVED",
};

/** A non-2xx PayPal error body (422). debug_id is safe to log; no secrets. */
export const errorResponseBody = {
  name: "UNPROCESSABLE_ENTITY",
  debug_id: "debug-123",
  details: [{ issue: "X" }],
};

/** verify-webhook-signature -> signature verified. */
export const verifySuccessResponse = { verification_status: "SUCCESS" };

/** verify-webhook-signature -> signature NOT verified. */
export const verifyFailureResponse = { verification_status: "FAILURE" };

/**
 * POST /v1/oauth2/token -> access token. "fake-token-xyz" is an obvious
 * placeholder, NOT a real secret; expires_in is 9 hours (PayPal's typical).
 */
export const oauthTokenResponse = {
  access_token: "fake-token-xyz",
  expires_in: 32400,
};
