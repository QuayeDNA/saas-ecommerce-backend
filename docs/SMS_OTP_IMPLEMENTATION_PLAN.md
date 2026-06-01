# SMS / OTP Implementation Plan

## Overview

Replace the current Vonage/Twilio OTP system with **Termii** as the sole SMS provider. Expand OTP coverage beyond registration to include login 2FA and sensitive-action verification. Add a mass SMS campaign feature for admin communications.

---

## Phase 1 — Replace SMS Provider with Termii

### Why Termii

- Best-in-region delivery for Ghana/Nigeria/West Africa
- Single API handles WhatsApp OTP with automatic SMS fallback (solves the "user not on WhatsApp" problem)
- Built-in bulk SMS and delivery report webhooks
- Pay-as-you-go pricing (~$0.005–0.02/sms)
- No long-term contract

### Files to Change

| File | What Changes |
|---|---|
| `backend/.env.example` | Remove `VONAGE_*`, `TWILIO_*`. Add `TERMII_API_KEY`, `TERMII_SENDER_ID` |
| `backend/package.json` | Remove `@vonage/server-sdk`, `twilio` |
| `backend/src/services/otpService.js` | Replace provider logic: remove Vonage/Twilio imports, add Termii API calls via axios. Keep `email` and `log` modes for dev. |
| `backend/src/constants/smsProviders.js` | **New file** — Provider enum and config constants |

### Termii OTP API

```
POST https://api.termii.com/api/sms/otp/send
{
  "api_key": "...",
  "message_type": "NUMERIC",
  "to": "233XXXXXXXXX",
  "from": "N-Alert",
  "channel": "whatsapp+dnd",
  "pin_attempts": 5,
  "pin_time_to_live": 10,
  "pin_length": 6
}
```

The `channel: "whatsapp+dnd"` option tries WhatsApp first and auto-falls back to SMS if the number is not registered on WhatsApp — no custom fallback logic needed.

### What Does NOT Change

- The `Otp` model (already handles all OTP types)
- The OTP generation/validation logic (6-digit, 10-min expiry, 5 attempts, TTL index)
- Registration OTP flow (remains intact)
- Email/console fallback modes

---

## Phase 2 — Expand OTP Coverage

### 2a — Login 2FA OTP

Add an optional second factor when users log in from unrecognized devices or IPs.

**Backend:**

| File | What Changes |
|---|---|
| `backend/src/controllers/authController.js` | Add `sendLoginOtp`, `verifyLoginOtp` handlers |
| `backend/src/services/mfaService.js` | **New file** — MFA logic: generate partial JWT after password check, require OTP before issuing full token |
| `backend/src/routes/authRoutes.js` | New routes: `POST /api/auth/send-login-otp`, `POST /api/auth/verify-login-otp` |
| `backend/src/middlewares/otpRequired.js` | **New file** — Middleware to force OTP on sensitive endpoints |

**Frontend:**

| File | What Changes |
|---|---|
| `BryteLinks/src/services/auth.service.ts` | Add OTP request/verify methods |
| `BryteLinks/src/pages/auth/LoginOtp.tsx` | **New page** — OTP entry screen after password verification |
| `BryteLinks/src/contexts/AuthContext.tsx` | Handle MFA flow: issue partial token → wait for OTP → full auth |

### 2b — Sensitive Action OTP

Require OTP re-verification for high-risk actions:

- Wallet withdrawals / large transfers
- Password changes
- Security PIN reset
- Account profile changes (phone, email)

**Backend:**

| File | What Changes |
|---|---|
| `backend/src/middlewares/otpRequired.js` | Reusable middleware — checks `req.session.otpVerified` or validates a fresh OTP |
| `backend/src/routes/walletRoutes.js` | Add OTP gate to withdrawal/payout endpoints |
| `backend/src/routes/authRoutes.js` | Add OTP gate to password/PIN change endpoints |

### What Does NOT Change (Phase 2)

- The `Otp` model
- The `User` model
- Existing registration flow
- Existing order creation flow (not affected by MFA)

---

## Phase 3 — Mass SMS Campaigns

Allow super admins to send SMS blasts to users (all users, by role, or specific segments).

### New Files

| File | Purpose |
|---|---|
| `backend/src/models/SmsCampaign.js` | Campaign schema: `{ title, message, audience[], status: draft/sending/sent/failed, sentCount, failedCount, scheduledAt, sentAt }` |
| `backend/src/services/smsService.js` | **New file** — Send single SMS via Termii, send bulk via Termii's bulk endpoint, check delivery report |
| `backend/src/controllers/smsCampaignController.js` | CRUD + send/pause campaign |
| `backend/src/routes/smsCampaignRoutes.js` | Admin-only routes under `/api/sms/campaigns` |
| `backend/src/jobs/scheduledSmsJob.js` | Cron job to send scheduled campaigns |
| `BryteLinks/src/pages/superadmin/sms/CampaignList.tsx` | List all campaigns |
| `BryteLinks/src/pages/superadmin/sms/CampaignCreate.tsx` | Compose + send campaign |
| `BryteLinks/src/pages/superadmin/sms/CampaignDetail.tsx` | Delivery report, retry failed recipients |

### Termii Bulk SMS API

```
POST https://api.termii.com/api/sms/send/bulk
{
  "api_key": "...",
  "to": ["233XXXXXXXXX", "233YYYYYYYYY"],
  "from": "N-Alert",
  "sms": "message content",
  "type": "plain"
}
```

### Admin Routes

```
GET    /api/sms/campaigns            — List all campaigns
POST   /api/sms/campaigns            — Create campaign (draft)
GET    /api/sms/campaigns/:id        — Campaign details + delivery stats
PATCH  /api/sms/campaigns/:id        — Edit draft campaign
POST   /api/sms/campaigns/:id/send   — Send campaign immediately
POST   /api/sms/campaigns/:id/schedule — Schedule for later
POST   /api/sms/campaigns/:id/pause  — Pause sending
POST   /api/sms/campaigns/:id/retry  — Retry failed deliveries
```

---

## File Change Summary

### Backend (15 files)

| Type | Files |
|---|---|
| **New models** | `SmsCampaign.js` |
| **New services** | `mfaService.js`, `smsService.js` |
| **New controllers** | `smsCampaignController.js` |
| **New routes** | `smsCampaignRoutes.js` |
| **New middleware** | `otpRequired.js` |
| **New jobs** | `scheduledSmsJob.js` |
| **New constants** | `smsProviders.js` |
| **Modified** | `.env.example`, `package.json`, `otpService.js`, `authController.js`, `authRoutes.js`, `walletRoutes.js` |

### Frontend (4 files)

| Type | Files |
|---|---|
| **New pages** | `LoginOtp.tsx`, `CampaignList.tsx`, `CampaignCreate.tsx`, `CampaignDetail.tsx` |
| **Modified** | `auth.service.ts`, `AuthContext.tsx` |

### Unchanged

- `Otp.js` model
- `User.js` model
- `Order.js` model
- All bundle/package/provider models
- All existing auth routes and registration flow
- Wallet system
- Notification system (in-app, push, WhatsApp)
- WebSocket service
- Cron jobs (other than the new one)

---

## Implementation Order

1. **Phase 1** — Replace with Termii (smallest change, unblocks everything)
2. **Phase 2a** — Login 2FA OTP
3. **Phase 2b** — Sensitive action OTP
4. **Phase 3** — Mass SMS campaigns

---

*This document covers only the SMS/OTP feature. The API sharing / integration system is archived for separate research and planning.*
