import type { PaymentStatus } from "../types.js";

/** Total mapping from a Braintree transaction status to the normalized status. */
export function mapStatus(braintreeStatus: string): PaymentStatus {
  switch (braintreeStatus) {
    case "authorized":
    case "authorizing":
      return "authorized";
    case "submitted_for_settlement":
    case "settlement_pending":
    case "settling":
      return "capture_pending";
    case "settled":
      return "captured";
    case "voided":
      return "voided";
    case "authorization_expired":
      return "expired";
    case "processor_declined":
    case "settlement_declined":
      return "declined";
    case "gateway_rejected":
    case "failed":
      return "failed";
    default:
      // Unknown or non-string values fail closed.
      return "failed";
  }
}
