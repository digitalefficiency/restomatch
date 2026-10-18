# Cost Projection — RestoMatch

צפי עלויות חודשיות פר-מסעדה ב-2026, USD. כולל overhead של ~30% לחישובי volume בלתי-צפויים.

## Per-restaurant breakdown (active pilot, 1 restaurant)

| Component | Provider | Tier | Estimated cost/mo |
|---|---|---|---|
| **Database** | Neon | Free tier (single project, multi-tenant) | $0 |
| **Database** | Neon | Pro tier (when scale > free) | $19 |
| **Redis** | Upstash | Pay-as-you-go (~10k req/day) | $1-3 |
| **Object Storage** | Cloudflare R2 | 5GB storage + 50k reads/mo | $0.50 |
| **OCR — Document AI** | Google Cloud | $1.50/1000 pages × ~300/mo | $5 |
| **OCR — Claude Vision** | Anthropic | claude-sonnet-4-6 vision @ ~$3/1M input tokens | $8-15 |
| **Email** | Resend | Free tier (3k emails/mo) | $0 |
| **WhatsApp Business** | Meta | $0.005 per session message × 200 | $1 |
| **Hosting (web)** | Vercel | Pro plan, shared across all restaurants | $20 / total |
| **Hosting (worker)** | Fly.io | shared-cpu-1x × 256MB | $5 / total |
| **Observability** | Sentry + PostHog | Free tiers | $0 |
| **Subtotal per restaurant** | | | **~$20-30** |

## Operating cost vs. ARPU

Pilot ARPU target: ₪400/mo (~$110)
Gross margin per restaurant: ~73% ($80 / $110)

When scaling beyond 10 restaurants, fixed Vercel/Fly costs amortize and margin approaches 85%.

## Cost optimization levers

1. **Document AI vs Claude Vision balance** — Claude Vision is more expensive but better at Hebrew. Strategy:
   - First 30 days of a restaurant: send to BOTH and reconcile (premium accuracy)
   - After 30 days: prefer Document AI for routine invoices, fall back to Claude only when DocAI confidence < 0.85
   - Saves ~50% of Claude costs after learning is sufficient

2. **R2 lifecycle** — Move invoice images to R2's "Infrequent Access" after 90 days. Reduces storage cost by ~60% on long-lived data.

3. **Embeddings batching** — Compute product embeddings in nightly cron, not on every OCR. Saves Anthropic embedding calls.

4. **Per-restaurant Neon database vs. shared multi-tenant** — Pilot uses shared. When a restaurant scales beyond 50k POs/mo, isolate to a dedicated Neon project.

## Year-1 forecast (15 restaurants)

| Line item | Amount/mo |
|---|---|
| Variable (15 restaurants × $25 avg) | $375 |
| Fixed (Vercel Pro + Fly + DNS) | $35 |
| **Total infra** | **$410** |
| **Revenue (15 × $110)** | **$1,650** |
| **Gross margin** | **75%** |

## Pre-launch (no real traffic)

- Neon: free tier ($0)
- Upstash: free tier ($0)
- Vercel: free tier ($0)
- Fly.io: free allowance ($0)
- Anthropic: pay-per-use, ~$5 for development
- **Total for dev: ~$5-10/month**

## Pilot (1 restaurant, real traffic)

- All variable costs: ~$25
- Vercel Pro (single project): $20
- **Total: ~$45/month**
- Customer pays: $110 → margin $65 first month
