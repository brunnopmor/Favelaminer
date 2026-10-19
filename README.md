# Mineable App

Independent Mineable-inspired platform prototype. This project is separate from StreamCore.

## What is included

- Responsive dark dashboard with virtual GPU catalog and navigation.
- Node.js/Express API served from the same origin as the web client.
- PostgreSQL schema for accounts, email verification, Pix payment requests, webhook receipts, audit events, and an append-only BRL ledger.
- Registration with email verification, password hashing, short-lived bearer sessions, and rate limits.
- Mercado Pago Pix order creation and signed webhook verification.
- Wallet balance and payment history queried from the server ledger.

## Important current limitations

- Real Pix payments remain **disabled until you configure provider credentials, database, email sender and webhook URL**.
- Bitcoin/crypto withdrawals are intentionally disabled; a payout/custody provider has not been selected or tested.
- Real mining is not connected. The dashboard's hashrate and mining reward figures are sample data and are not claims of actual mining or yield.
- Do not enable production deposits until the app, legal terms, privacy notice, ledger reconciliation, refunds/disputes, and payment webhook are tested end-to-end.

## Run locally

Requirements: Node.js 20+ and PostgreSQL.

1. Create a local PostgreSQL database.
2. Apply the schema: `psql "$DATABASE_URL" -f server/sql/schema.sql`.
3. Copy `.env.example` into `server/.env` and fill local/test values. The backend loads `dotenv` from its process working directory, so start it inside `server/`.
4. Install server dependencies and run:

   ```sh
   cd server
   cp ../.env.example .env
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`. The same server serves the frontend and `/api` endpoints. Never commit the populated `server/.env`.

The placeholder `DATABASE_URL`, JWT secret, Resend API key, Mercado Pago access token and webhook secret must be configured in the deployment secret manager. Use Mercado Pago test credentials first.

## Mercado Pago Pix setup

1. Create/configure an application in Mercado Pago Developers and get a test Access Token.
2. Configure a webhook for orders/payment updates to `https://YOUR_DOMAIN/api/webhooks/mercadopago`; set the webhook secret as `MP_WEBHOOK_SECRET`.
3. Set `MP_ACCESS_TOKEN` only in the server's environment, never in browser JavaScript.
4. Register a verified sender with the email provider and configure `RESEND_API_KEY` and `MAIL_FROM`.
5. Test payment creation, QR/copy-and-paste code, signed webhook verification, duplicate notifications, wrong amounts, pending/failed orders, database outages and ledger reconciliation before moving to production credentials.

The server checks the provider's order status after receiving a signed webhook and credits BRL only once in a database transaction after settlement is confirmed. Never mark a client-side redirect or browser message as proof of payment.

## Security notes

- Never trust balances, amount settlement, identity, or payout destination from the browser.
- Do not add payment provider secrets to GitHub files or chat messages.
- Use HTTPS in production and a strong random `JWT_SECRET` (32+ characters).
- Restrict database access, use encrypted backups, monitor webhooks and maintain a reconciliation process.
- Crypto payouts need their own validated provider/custody integration, limits, approval controls, and on-chain confirmation. They are not implemented.
