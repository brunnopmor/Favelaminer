import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const required = ["DATABASE_URL", "JWT_SECRET", "APP_BASE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) console.warn("Missing server environment variables:", missing.join(", "));

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be a random secret of at least 32 characters in production.");
}
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
}) : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean), credentials: false }));
app.use(express.json({ limit: "24kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api/payments", rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false }));

function database() {
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.status = 503;
    throw error;
  }
  return pool;
}
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function verifyMpSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;
  const signatureHeader = String(req.get("x-signature") || "");
  const requestId = String(req.get("x-request-id") || "");
  const dataId = String(req.query["data.id"] || req.query.id || "").toLowerCase();
  if (!signatureHeader || !requestId || !dataId) return false;
  const fields = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const index = part.indexOf("=");
    return index > -1 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }).filter(([key]) => key));
  if (!fields.ts || !fields.v1) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${fields.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqualHex(fields.v1, expected);
}
function signToken(user) {
  if (!process.env.JWT_SECRET) throw Object.assign(new Error("JWT_SECRET is not configured."), { status: 503 });
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "20m", issuer: "mineable-api", audience: "mineable-app" });
}
async function auth(req, res, next) {
  try {
    const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Authentication required." });
    const claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: "mineable-api", audience: "mineable-app" });
    const result = await database().query("SELECT id,email,email_verified_at FROM users WHERE id=$1", [claims.sub]);
    if (!result.rowCount) return res.status(401).json({ error: "Invalid account." });
    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") return res.status(401).json({ error: "Session expired; sign in again." });
    next(error);
  }
}
function requireVerifiedEmail(req, res, next) {
  if (!req.user.email_verified_at) return res.status(403).json({ error: "Verify your email before making payments." });
  next();
}
function emailValid(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function sendVerificationEmail(email, token) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM || !process.env.APP_BASE_URL) {
    throw Object.assign(new Error("Email verification is not configured. Set RESEND_API_KEY, MAIL_FROM and APP_BASE_URL before enabling registration."), { status: 503 });
  }
  const link = new URL("/verify-email", process.env.APP_BASE_URL);
  link.searchParams.set("token", token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [email], subject: "Verify your Mineable account", html: `<p>Confirm your email to continue:</p><p><a href="${link.toString()}">Verify email</a></p><p>This link expires in 30 minutes. If you did not create an account, ignore this email.</p>` })
  });
  if (!response.ok) throw Object.assign(new Error("Email provider rejected the verification email."), { status: 502 });
}
async function mpRequest(url, options = {}) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error("Mercado Pago production/test token is not configured on the server."), { status: 503 });
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Payment provider request failed.");
    error.status = 502;
    error.providerStatus = response.status;
    throw error;
  }
  return body;
}
function pixFields(order) {
  const payment = order?.transactions?.payments?.[0] || {};
  const method = payment?.payment_method || {};
  return {
    qr_code: method.qr_code || method.qr_code_base64_data || null,
    qr_code_base64: method.qr_code_base64 || null,
    ticket_url: method.ticket_url || null
  };
}

app.get("/api/health", (_req, res) => res.json({
  status: "ok",
  service: "mineable-api",
  paymentsConfigured: Boolean(process.env.MP_ACCESS_TOKEN && process.env.MP_WEBHOOK_SECRET),
  databaseConfigured: Boolean(pool),
  realMiningConnected: false,
  cryptoPayoutsEnabled: false
}));

app.post("/api/auth/register", async (req, res, next) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!emailValid(email) || typeof password !== "string" || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "Provide a valid email and a password between 12 and 128 characters." });
  }
  const client = await database().connect();
  let user;
  const rawToken = crypto.randomBytes(32).toString("base64url");
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await client.query(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email",
      [email, passwordHash]
    );
    user = inserted.rows[0];
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await client.query(
      "INSERT INTO email_verification_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
      [user.id, tokenHash]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    return next(error);
  } finally {
    client.release();
  }
  try {
    await sendVerificationEmail(email, rawToken);
    res.status(201).json({ message: "Account created. Check your email to verify it before signing in." });
  } catch (error) {
    // Keep account unverified and don't return the secret token to the browser.
    next(error);
  }
});

app.post("/api/auth/verify", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    if (token.length < 30 || token.length > 200) return res.status(400).json({ error: "Invalid verification token." });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await database().query(
      "UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id",
      [hash]
    );
    if (!result.rowCount) return res.status(400).json({ error: "The verification link is invalid or expired." });
    const userId = result.rows[0].user_id;
    const user = await database().query("UPDATE users SET email_verified_at=now() WHERE id=$1 RETURNING id,email", [userId]);
    res.json({ message: "Email verified. You can now sign in.", token: signToken(user.rows[0]) });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!emailValid(email) || typeof password !== "string") return res.status(400).json({ error: "Email and password are required." });
    const result = await database().query("SELECT id,email,password_hash,email_verified_at FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid email or password." });
    if (!user.email_verified_at) return res.status(403).json({ error: "Verify your email before signing in." });
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (error) { next(error); }
});

app.get("/api/account", auth, async (req, res, next) => {
  try {
    const result = await database().query(
      "SELECT asset, COALESCE(SUM(CASE WHEN direction='credit' THEN amount_minor ELSE -amount_minor END),0)::bigint AS balance_minor FROM ledger_entries WHERE user_id=$1 GROUP BY asset",
      [req.user.id]
    );
    const payments = await database().query(
      "SELECT id,amount_minor,currency,status,created_at,credited_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
      [req.user.id]
    );
    res.json({ user: { id: req.user.id, email: req.user.email }, balances: result.rows, payments: payments.rows });
  } catch (error) { next(error); }
});

app.post("/api/payments/pix", auth, requireVerifiedEmail, async (req, res, next) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || Math.round(amount * 100) !== amount * 100 || amount < 5 || amount > 5000) {
    return res.status(400).json({ error: "Pix top-ups must be between R$ 5.00 and R$ 5,000.00." });
  }
  if (!process.env.MP_ACCESS_TOKEN || !process.env.APP_BASE_URL) return res.status(503).json({ error: "Pix payment integration is not configured." });
  const client = await database().connect();
  const paymentId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO payments(id,user_id,external_reference,idempotency_key,amount_minor) VALUES($1,$2,$1,$3,$4)",
      [paymentId, req.user.id, idempotencyKey, Math.round(amount * 100)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    return next(error);
  }
  client.release();
  try {
    const order = await mpRequest("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        external_reference: paymentId,
        total_amount: amount.toFixed(2),
        payer: { email: req.user.email },
        transactions: {
          payments: [{
            amount: amount.toFixed(2),
            payment_method: { id: "pix", type: "bank_transfer" }
          }]
        }
      })
    });
    const fields = pixFields(order);
    if (!order.id || (!fields.qr_code && !fields.qr_code_base64 && !fields.ticket_url)) {
      throw Object.assign(new Error("The provider did not return Pix checkout details."), { status: 502 });
    }
    await database().query(
      "UPDATE payments SET provider_order_id=$1,qr_code=$2,qr_code_base64=$3,ticket_url=$4,provider_status=$5,provider_payload=$6,updated_at=now() WHERE id=$7",
      [String(order.id), fields.qr_code, fields.qr_code_base64, fields.ticket_url, String(order.status || "pending"), JSON.stringify({ id: order.id, status: order.status, external_reference: order.external_reference }), paymentId]
    );
    res.status(201).json({ paymentId, providerOrderId: String(order.id), amount: amount.toFixed(2), currency: "BRL", status: "pending", ...fields, notice: "Credits are added only after a signed provider notification confirms settlement." });
  } catch (error) {
    await database().query("UPDATE payments SET provider_status='creation_error',updated_at=now() WHERE id=$1 AND status='pending'", [paymentId]).catch(() => {});
    next(error);
  }
});

app.post("/api/webhooks/mercadopago", async (req, res, next) => {
  try {
    if (!verifyMpSignature(req)) return res.status(401).json({ error: "Invalid webhook signature." });
    const providerOrderId = String(req.query["data.id"] || req.query.id || "");
    const requestId = String(req.get("x-request-id") || "");
    const eventKey = `${providerOrderId}:${requestId}`;
    const client = await database().connect();
    try {
      const inserted = await client.query(
        "INSERT INTO webhook_events(provider,event_key,event_type) VALUES('mercadopago',$1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [eventKey, String(req.body?.action || req.body?.type || "unknown")]
      );
      if (!inserted.rowCount) {
        await client.query("COMMIT").catch(() => {});
        return res.status(200).json({ received: true, duplicate: true });
      }
    } finally { client.release(); }

    const order = await mpRequest("https://api.mercadopago.com/v1/orders/" + encodeURIComponent(providerOrderId), { method: "GET" });
    const reference = String(order.external_reference || "");
    const payments = order?.transactions?.payments || [];
    const settled = order.status === "processed" && payments.some(p => p.status === "processed" || p.status === "approved");
    const db = database();
    const client2 = await db.connect();
    try {
      await client2.query("BEGIN");
      const paymentResult = await client2.query("SELECT * FROM payments WHERE id=$1 AND provider_order_id=$2 FOR UPDATE", [reference, providerOrderId]);
      if (paymentResult.rowCount && settled) {
        const payment = paymentResult.rows[0];
        const paidAmount = Number(order.total_amount);
        const expectedAmount = Number(payment.amount_minor) / 100;
        const currency = String(order.currency_id || "BRL").toUpperCase();
        if (Math.round(paidAmount * 100) !== Number(payment.amount_minor) || currency !== "BRL") {
          await client2.query("UPDATE payments SET provider_status='amount_mismatch',provider_payload=$1,updated_at=now() WHERE id=$2", [JSON.stringify({ id: order.id, status: order.status, amount: paidAmount, currency }), payment.id]);
        } else if (!payment.credited_at) {
          await client2.query("UPDATE payments SET status='approved',provider_status=$1,provider_payload=$2,credited_at=now(),updated_at=now() WHERE id=$3", [String(order.status), JSON.stringify({ id: order.id, status: order.status }), payment.id]);
          await client2.query(
            "INSERT INTO ledger_entries(user_id,asset,direction,amount_minor,entry_type,reference_id) VALUES($1,'BRL','credit',$2,'pix_deposit',$3) ON CONFLICT DO NOTHING",
            [payment.user_id, payment.amount_minor, payment.id]
          );
        }
      }
      await client2.query("COMMIT");
    } catch (error) { await client2.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client2.release(); }
    res.status(200).json({ received: true });
  } catch (error) { next(error); }
});

app.post("/api/withdrawals/crypto", auth, requireVerifiedEmail, (_req, res) => {
  // Fail closed: never accept withdrawal requests until an audited payout provider,
  // risk controls, ledger reservation, and on-chain reconciliation are implemented.
  res.status(503).json({ error: "Crypto withdrawals are disabled. No crypto payout provider is configured or validated." });
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("API error:", error.message);
  res.status(status).json({ error: status >= 500 ? (status === 503 ? error.message : "The request could not be completed.") : error.message });
});

app.listen(port, () => console.log(`Mineable API listening on port ${port}`));

process.on("SIGTERM", async () => {
  if (pool) await pool.end();
  process.exit(0);
});
