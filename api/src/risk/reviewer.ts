// Provider-neutral AI review interface. No provider types appear here.

export interface ReviewRequest {
  /** Merchant domain. Untrusted. */
  payee: string;
  /** Item description. Untrusted. */
  description: string;
  /** Agent justification. Untrusted. */
  justification: string;
  category?: string;
  title?: string;
  productId?: string;
  /** Integer cents plus ISO 4217 currency. */
  amountCents: number;
  currency: string;
  /** Channel3 price check status, computed deterministically before the AI call. */
  priceStatus: "ok" | "low" | "high" | "unknown";
}

export interface RiskReviewer {
  /**
   * Returns the raw parsed model JSON. The caller validates it with the strict
   * AiReviewSchema. Throws on transport, HTTP, timeout, or JSON failure.
   */
  review(req: ReviewRequest, opts: { signal: AbortSignal }): Promise<unknown>;
}
