// Typed, secret-free provider failure. The message must be safe to log and
// return: never include nonces, payment-method tokens or API keys.

export type ProviderName = "braintree" | "paypal";

export interface ProviderErrorInit {
  provider: ProviderName;
  /** e.g. "declined", "rejected", "not_found", "unsupported", "invalid_request", "provider_error" */
  code: string;
  message: string;
  transactionId?: string;
  processorCode?: string;
}

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: string;
  readonly transactionId?: string;
  readonly processorCode?: string;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.code = init.code;
    if (init.transactionId !== undefined) this.transactionId = init.transactionId;
    if (init.processorCode !== undefined) this.processorCode = init.processorCode;
  }
}
