// Provider-neutral payment types. Normalized shapes only: nothing here may
// import from `braintree` or the PayPal adapter modules.

export type PaymentStatus =
  | "authorized"
  | "capture_pending"
  | "captured"
  | "voided"
  | "expired"
  | "declined"
  | "failed";

export interface AuthorizeInput {
  amountCents: number;
  currency: string;
  intentId: string;
  paymentMethodRef: string;
}

export interface AuthorizeResult {
  authorizationId: string;
  status: PaymentStatus;
}

export interface CaptureResult {
  captureId: string;
  status: PaymentStatus;
}

export interface VoidResult {
  voidId: string;
  status: PaymentStatus;
}

export interface WebhookEvent {
  /** Dedupe key (derived from kind, subject id and timestamp). */
  key: string;
  kind: string;
  timestampMs: number;
  transactionId?: string;
  status?: PaymentStatus;
}

export interface PaymentProvider {
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  capture(authorizationId: string, amountCents: number): Promise<CaptureResult>;
  void(authorizationId: string): Promise<VoidResult>;
  getStatus(authorizationId: string): Promise<{ status: PaymentStatus }>;
  parseWebhook(
    rawFields: Record<string, string | undefined>,
  ): Promise<WebhookEvent>;
  linkPaymentMethod(input: {
    ownerId: string;
    nonce: string;
  }): Promise<{ customerId: string; paymentMethodToken: string }>;
}
