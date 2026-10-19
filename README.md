# Mineable App

Independent Mineable-inspired platform prototype. This repository is not connected to StreamCore.

## Current status

The frontend is a responsive product prototype. **Real crypto mining, balances, deposits, and withdrawals are not enabled yet.** The UI sample values are not spendable funds and must never be presented as real earnings.

## Production payment architecture

- **Authentication:** real accounts, email verification, optional MFA, server-side authorization, rate limiting, audit logs.
- **Ledger:** append-only double-entry accounting in PostgreSQL. Never accept an amount, balance, payout destination, or settlement status from the browser. Use database transactions and idempotency keys.
- **Payments:** integrate a supported payment provider in server-side code only. Verify webhook signatures; retrieve payment state from provider; deduplicate events; credit the ledger only after confirmed settlement. Store credentials in server-side environment secrets.
- **Crypto payouts:** use a dedicated payout/custody provider or a reviewed wallet service that supports chosen assets and networks. Validate addresses, apply limits and risk checks, use approval policy, and reconcile receipts. Mark withdrawals completed only after provider receipt or confirmed on-chain transaction.
- **Mining truth:** real rewards require actual physical miners or a real pool API, verified shares, difficulty/reward accounting, fees and payout thresholds. Virtual GPUs are not real mining.
- **Operations:** testnet/sandbox first, monitoring, backups, incident response, legal/tax review, terms/privacy, and a kill switch for deposits and withdrawals.

## Suggested production stack

- Frontend: HTML/CSS/JavaScript prototype (current).
- Backend: TypeScript API with request schema validation and role-based access.
- Database: PostgreSQL with migrations and immutable ledger records.
- Queue: durable jobs for webhooks, reconciliation, and withdrawals.
- Integrations: select a payment provider and crypto payout provider after confirming supported payment rails, assets, jurisdiction, and account eligibility.

## Server-side environment placeholders

Configure these in the backend host's secret manager only, never in source code:

- `APP_BASE_URL`
- `DATABASE_URL`
- `PAYMENT_PROVIDER_SECRET_KEY`
- `PAYMENT_WEBHOOK_SECRET`
- `CRYPTO_PAYOUT_PROVIDER_KEY`

These are placeholders, not active credentials.

## Decisions required before enabling real funds

1. Will deposits be BRL via Pix/card, crypto deposits, or both?
2. Which crypto asset and network should withdrawals support?
3. Do mining rewards come from connected real equipment/pool, or a separately funded reward pool?
4. Which payout provider/custody model will be used?

## Deployment

Static hosting can serve the interface only. A backend and verified credentials must be deployed before any real financial operation can be activated.