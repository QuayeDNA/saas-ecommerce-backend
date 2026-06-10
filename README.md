# SAAS E-Commerce Backend API

Express 5 + MongoDB API serving all three storefront brands (BryteLinks, Directdata, Caskmaf Hub).

## Stack

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express 5
- **Database:** MongoDB with Mongoose ODM
- **Auth:** JWT (access + refresh tokens) + OTP
- **Real-time:** WebSocket (`ws`)
- **Payment:** Paystack (inline checkout, webhooks, subaccounts)
- **Email:** Nodemailer (Gmail)
- **Push:** Web Push API (VAPID)
- **Validation:** Joi
- **Storage:** Multer (image uploads)
- **Cache:** Redis (optional)
- **Logging:** Winston
- **Jobs:** Node.js `cron` patterns

## Quick Start

```bash
cp .env.example .env
# Fill in DBURI, JWTSECRET, etc.
npm install
npm run dev    # Starts on :5050 with nodemon
```

## API Routes

| Prefix | Purpose |
|---|---|
| `/api/auth` | Login, register, OTP, refresh, password reset, user management |
| `/api/orders` | Create, process, cancel, track, analytics |
| `/api/packages` | CRUD, by-provider, stats |
| `/api/bundles` | CRUD, pricing, by-package, analytics |
| `/api/providers` | CRUD, public listing, analytics |
| `/api/wallet` | Balance, transactions, top-up, Paystack verify, payouts |
| `/api/storefront` | Public store pages, ordering, tracking; agent storefront management |
| `/api/announcements` | CRUD, broadcast, active/public endpoints |
| `/api/notifications` | Read/unread, clear, preferences |
| `/api/analytics` | Superadmin, agent, summary, charts, realtime |
| `/api/commissions` | Process, withdraw, balance, leaderboard |
| `/api/referrals` | Dashboard, tree, leaderboard |
| `/api/settings` | Site status, wallet/payout/fee settings, signup approval |
| `/api/push` | Subscribe, unsubscribe, preferences |
| `/api/upload` | Image upload |
| `/api/audit-logs` | User timeline, export, stats |
| `/api/webhooks/paystack` | Paystack charge success webhook |
| `GET /health` | Health check |

## Background Jobs (11)

| Job | Schedule |
|---|---|
| `orderProcessing` | Every 10s — processes pending orders |
| `dailyCommissionProcessing` | Daily — processes agent commissions |
| `paystackVerificationRetry` | Every 5min — retries failed Paystack verifications |
| `pendingPaymentExpiry` | Every 15min — auto-cancels expired pending payments |
| `momoPendingExpiry` | Every 30min — expires stale MoMo transactions |
| `cancelledStorefrontOrdersCleanup` | Daily — purges old cancelled orders |
| `reportedOrdersCleanup` | Daily — cleans up reported orders |
| `payoutReconciliationJob` | Every 30min — reconciles stuck payouts |
| `inactiveStoreSuspension` | Daily — auto-suspends inactive stores |
| `announcementExpiration` | Every 30min — expires scheduled announcements |
| `clearOldNotifications` | Daily — notification cleanup |

## Models

`User`, `Order`, `Bundle`, `Package`, `Provider`, `AgentStorefront`, `StorefrontPricing`, `WalletTransaction`, `PayoutRequest`, `PaystackVerificationTask`, `Commission`, `EarningsTransaction`, `Notification`, `Announcement`, `AuditLog`, `Otp`, `Settings`

## App-Aware Features

The backend differentiates between brands (`app_a` / BryteLinks, `app_b` / Directdata) for:
- Order number prefixes (ORD-, DRD-)
- Agent code prefixes (BLA-, DDA-)
- Storefront prefixes (BAGS-, DDST-)
- Analytics scoping
- CORS origin validation
