/**
 * Provider-agnostic billing rails.
 *
 * The entitlement layer (plans/subscriptions/usage) is the source of truth for
 * what a tenant may do; a BillingProvider only handles money movement and
 * reconciles subscription status via webhooks. During the pilot the
 * NoopBillingProvider is used — plans are assigned manually in the admin panel,
 * no card is charged — so the whole product works before any PSP integration.
 *
 * First real provider (recommended): Grow (Meshulam) for ₪ recurring charges +
 * Morning (Green Invoice) for tax invoices. The Grow implementation lands when
 * credentials exist; the interface below is what it must satisfy.
 */

export type BillingProviderId = 'noop' | 'grow' | 'cardcom';

export interface CustomerInput {
  billingAccountId: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface RecurringChargeInput {
  billingAccountId: string;
  planKey: string;
  priceAgorotMonthly: number;
  customerRef: string;
}

export interface WebhookVerification {
  valid: boolean;
  eventType: string;
  idempotencyKey: string;
  billingAccountRef?: string;
  payload: unknown;
}

export interface BillingProvider {
  readonly id: BillingProviderId;
  /** Create / fetch the provider-side customer; returns its ref. */
  createCustomer(input: CustomerInput): Promise<{ customerRef: string }>;
  /** Start a tokenized recurring charge; returns the subscription ref. */
  startRecurringCharge(input: RecurringChargeInput): Promise<{ subscriptionRef: string }>;
  /** Cancel an active recurring charge. */
  cancel(subscriptionRef: string): Promise<void>;
  /** Verify a webhook payload + signature into a normalized event. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookVerification>;
}

/**
 * Pilot provider: assigns plans without charging. createCustomer/charge return
 * synthetic refs so the subscription flow is exercised end-to-end; webhooks are
 * inert.
 */
export class NoopBillingProvider implements BillingProvider {
  readonly id = 'noop' as const;

  async createCustomer(input: CustomerInput): Promise<{ customerRef: string }> {
    return { customerRef: `noop_cust_${input.billingAccountId}` };
  }

  async startRecurringCharge(input: RecurringChargeInput): Promise<{ subscriptionRef: string }> {
    return { subscriptionRef: `noop_sub_${input.billingAccountId}_${input.planKey}` };
  }

  async cancel(): Promise<void> {
    /* nothing to cancel */
  }

  async verifyWebhook(): Promise<WebhookVerification> {
    return { valid: false, eventType: 'noop', idempotencyKey: '', payload: null };
  }
}

/**
 * Grow (Meshulam) skeleton — credential-gated. Throws a clear "not configured"
 * error until GROW_API_KEY is provisioned, mirroring the OCR/notifier scaffolds
 * so activation is just adding a secret.
 */
export class GrowBillingProvider implements BillingProvider {
  readonly id = 'grow' as const;
  constructor(private readonly apiKey: string | undefined = process.env.GROW_API_KEY) {}

  private ensureConfigured(): string {
    if (!this.apiKey) {
      throw new Error('GrowBillingProvider not configured — set GROW_API_KEY');
    }
    return this.apiKey;
  }

  async createCustomer(): Promise<{ customerRef: string }> {
    this.ensureConfigured();
    // VERIFY: POST Grow create-customer; map response → customerRef
    throw new Error('GrowBillingProvider.createCustomer not yet wired');
  }

  async startRecurringCharge(): Promise<{ subscriptionRef: string }> {
    this.ensureConfigured();
    throw new Error('GrowBillingProvider.startRecurringCharge not yet wired');
  }

  async cancel(): Promise<void> {
    this.ensureConfigured();
    throw new Error('GrowBillingProvider.cancel not yet wired');
  }

  async verifyWebhook(): Promise<WebhookVerification> {
    this.ensureConfigured();
    throw new Error('GrowBillingProvider.verifyWebhook not yet wired');
  }
}

/** Pick the provider from env; defaults to Noop for the pilot. */
export function resolveBillingProvider(
  id: BillingProviderId = (process.env.BILLING_PROVIDER as BillingProviderId) ?? 'noop',
): BillingProvider {
  switch (id) {
    case 'grow':
      return new GrowBillingProvider();
    case 'noop':
    case 'cardcom':
    default:
      return new NoopBillingProvider();
  }
}
