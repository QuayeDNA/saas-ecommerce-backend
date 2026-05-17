# Backend Analysis & Refactoring Plan: User & Authentication System

## 🔍 Backend Analysis: The Good, The Bad, & Recommendations

### The Good
1. **Solid Multi-Tenant Foundation:** The `User.js` model securely links sub-entities to parents using the `tenantId` field and leverages compound indexes (`tenantId: 1, userType: 1`) which is excellent for query performance.
2. **Security Measures:** Passwords are hashed with `bcrypt` (salt rounds: 12), a custom `.toJSON()` method strips sensitive data (`password`, `tokens`), and `HttpOnly` cookies and refresh tokens are used for sessions.
3. **Validation & Middleware Pipeline:** Routing uses dedicated schema validation (`validate(loginValidation)`) and standard `authenticate` / `authorize(roles)` middlewares, preventing unexpected data from hitting the database and protecting routes correctly.
4. **Push Notifications Base:** The DB schema is already primed for Push Notifications (`pushSubscription`, `pushNotificationPreferences`).

### The Bad (Areas for Improvement)
1. **Controller Bloat (Fat Controllers):** The `authController.js` file (over 1,000 lines) contains both HTTP transport logic and deep business logic. This hurts testability and readability.
2. **Magic Strings Everywhere:** Role arrays like `['agent', 'super_agent', 'dealer', 'super_dealer']` are hardcoded in schema definitions, middleware, and controllers multiple times. This is prone to typos and painful if you ever need to add a new role.
3. **Dead Email Logic:** Mongoose models and the auth controller rely on an `emailService` for password resets and verifications, which is essentially dead code since no email gateways are used.
4. **Query Performance Constraints:** The database pulls heavier Mongoose documents into memory even for read-only user listings, causing high memory usage during peak traffic.

---

## 🔐 Secure Password Reset Strategy (The "Security PIN" Approach)

Given the flat, autonomous nature of the actual business hierarchy, second-party manager approval creates too much friction. Instead, we will implement a frictionless, self-service **Security PIN** workflow.

**The Proposed Flow:**
1. **Setup (Registration / Next Login):** Users must set a strict 4-to-6 digit `securityPin` during registration. For existing users, the system flags `requiresPinSetup: true`, prompting them to configure it on their next login. The PIN is hashed using `bcrypt` (like passwords).
2. **Forgot Password Request:** The user clicks "Forgot Password" and is prompted for their `phone` (or `agentCode`) AND their `securityPin`.
3. **Verification & Token Issue:** If the phone and PIN match, the system generates a short-lived `resetToken` and immediately returns it to the client.
4. **Password Change:** The client subsequently uses this `resetToken` to set a new password on the `/auth/reset-password` endpoint.
5. **Fallback:** If a user loses *both* their password AND their PIN, they must contact Support/Super Admin to manually trigger a reset since self-service relies on knowing the PIN.

---

## 📋 Action Plan: User & Auth System Refactor Tasks

*(Note: DRY principles, high maintainability, and reusability are paramount. All duplicated logic must be centralized into reusable services to prevent breaking interconnected features.)*

### Phase 1: DRY Architecture & Developer Experience (DX)
- [ ] **Extract Constants:** Create `src/constants/roles.js`. Move all role arrays (`['agent', 'super_agent', 'dealer', 'super_dealer', 'super_admin']`) into centralized constants to prevent typos and ease future role expansions.
- [ ] **Service Layer Abstraction:** Create `src/services/authService.js` and `src/services/userService.js`. Extract *all* heavy DB/business logic from `authController.js` (which currently has 1000+ lines). Controllers should only handle HTTP req/res formatting and catching errors.
- [ ] **Mongoose Optimization:** Add `.lean()` to list queries (`/users`), keeping the memory footprint low by returning plain JSON objects instead of heavy Mongoose documents.

### Phase 2: Implement "Security PIN" (No-Email Reset Flow)
- [ ] **Clean User Schema:** Remove dead email fields (`verificationToken`, `verificationResent`). Add `securityPin` (String) and `requiresPinSetup` (Boolean, default `true` for migrating existing users).
- [ ] **PIN Setup Endpoints:** Build `/auth/setup-pin` where authenticated users can configure their PIN.
- [ ] **Refactor `forgotPassword`:** Completely remove `emailService`. Rewrite to validate `phone`/`agentCode` against the hashed `securityPin`. On success, return a temporary secure token.
- [ ] **Refactor `resetPassword`:** Accept the `resetToken` along with the `newPassword`. Verify, hash, and update the password safely.

### Phase 3: Deep System Hardening
- [ ] **Session Revocation:** Moving roles/suspending agents must trigger an exact pipeline to wipe active `refreshToken` cookies/DB flags so immediate access revocation is guaranteed.
- [ ] **Global Error Standard:** Standardize API error responses from the new `authService` throughout the controller.
- [ ] **Rate Limiting:** Protect the new `forgotPassword` PIN endpoint with explicit rate-limiting (`advancedRateLimit.js`) to prevent dictionary attacks brute-forcing the 4-digit PIN.
