# Phase 1: Authentication Core (Week 3-5)

This document describes the authentication/security features in DocSync, how they are used, which libraries are involved, required dependencies, and configuration/actions you should take.

## 1) Scope and Deliverables

Requested scope:
1. Signup/login/logout
2. Email verification
3. Password reset
4. Secure session/token handling
5. Access + refresh tokens or secure cookie sessions
6. Session expiry and revoke-all
7. Rate limiting on auth endpoints
8. Lockout after repeated failures
9. Basic auth audit logs

Deliverables expected:
1. Working auth API + frontend flows
2. Session management UI
3. Security event logging

Current DocSync status: Implemented (with in-memory persistence).

## 2) Libraries and Dependencies Used

Backend dependencies used for auth/security:
- express: HTTP API server
- jsonwebtoken: access token and pending 2FA JWTs
- bcryptjs: password hashing and verification
- cookie-parser: refresh/csrf cookie handling
- express-rate-limit: auth endpoint throttling
- uuid: IDs for users/sessions/logs
- otplib: TOTP-based 2FA generation/validation
- qrcode: QR code generation for 2FA provisioning
- cors: credentialed CORS for cookie-based auth flow

Frontend dependencies for auth flows:
- react
- react-router-dom
- browser fetch API via `apiFetch`

Dependency references:
- backend package file: [backend/package.json](backend/package.json)
- frontend API client: [frontend/src/lib/api.ts](frontend/src/lib/api.ts)

## 3) Architecture Summary

DocSync uses a hybrid approach:
1. Short-lived access token (Bearer JWT) for API auth
2. Long-lived refresh token in HTTP-only cookie
3. CSRF token cookie (`docsync_csrf`) + `X-CSRF-Token` header for refresh endpoint
4. Server-side session store (in-memory Map) for refresh token validity, expiry, and revocation

Key auth/session internals:
- Auth middleware: [backend/src/middleware/auth.js](backend/src/middleware/auth.js)
- Auth routes: [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js)
- In-memory stores: [backend/src/store/index.js](backend/src/store/index.js)
- App route mounting: [backend/src/app.js](backend/src/app.js)

## 4) Implemented Feature Matrix

### 4.1 Signup/Login/Logout

Implemented endpoints:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/login/2fa` (if user has 2FA enabled)

Frontend usage:
- Signup/Login UI: [frontend/src/components/pages/AuthPage.tsx](frontend/src/components/pages/AuthPage.tsx)
- API calls: [frontend/src/lib/api.ts](frontend/src/lib/api.ts)

Behavior notes:
- Register requires: name, valid email, password >= 8 chars
- Login accepts email or username on backend; frontend currently sends email field
- Logout revokes current session and clears auth cookies

### 4.2 Email Verification

Implemented endpoints:
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`

Frontend usage:
- Verify page: [frontend/src/components/pages/VerifyEmailPage.tsx](frontend/src/components/pages/VerifyEmailPage.tsx)
- Auth signup flow stores verification state and supports resend in [frontend/src/components/pages/AuthPage.tsx](frontend/src/components/pages/AuthPage.tsx)

Behavior notes:
- Email verification required before successful login
- In non-production (`NODE_ENV != production`), response includes preview link/token for testing

### 4.3 Password Reset

Implemented endpoints:
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

Frontend usage:
- Forgot password trigger: [frontend/src/components/pages/AuthPage.tsx](frontend/src/components/pages/AuthPage.tsx)
- Reset page: [frontend/src/components/pages/ResetPasswordPage.tsx](frontend/src/components/pages/ResetPasswordPage.tsx)

Behavior notes:
- Reset token has TTL
- Password reset revokes all existing sessions for that user

### 4.4 Secure Session/Token Handling

Implemented endpoints:
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`
- `POST /api/auth/sessions/revoke-all`

Frontend session lifecycle:
- On app startup: calls `refresh()` to restore secure session
- Auto-refresh: refreshes before access token expiry
- App logic: [frontend/src/App.tsx](frontend/src/App.tsx)

Behavior notes:
- Access token is short-lived JWT
- Refresh token is opaque, stored as hash in server session record
- Session revocation supported per-session and revoke-all

### 4.5 Session Management UI

Implemented UI:
- Security center page: [frontend/src/components/pages/SecuritySettingsPage.tsx](frontend/src/components/pages/SecuritySettingsPage.tsx)
- Features:
  - List active sessions
  - Revoke current/other session
  - Revoke all sessions
  - View account status and security signals

### 4.6 Rate Limiting

Implemented middleware:
- [backend/src/middleware/rate-limit.js](backend/src/middleware/rate-limit.js)

Configured limiters:
- `authRateLimit`: generic auth endpoints
- `loginRateLimit`: strict login limit (includes key by IP + identity)
- `registerRateLimit`: signup throttle
- `passwordResetRateLimit`: reset request throttle

### 4.7 Lockout After Repeated Failures

Implemented in login flow:
- Lockout threshold and duration configured in auth routes
- Locks account after repeated bad credentials
- Counters reset after successful login/password reset

Reference:
- [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js)

### 4.8 Basic Auth Audit Logs

Implemented logging:
- In-memory audit logs map with action/status/ip/UA/metadata
- Read endpoint: `GET /api/auth/audit-logs`

Frontend usage:
- Audit list in security UI: [frontend/src/components/pages/SecuritySettingsPage.tsx](frontend/src/components/pages/SecuritySettingsPage.tsx)

Store reference:
- [backend/src/store/index.js](backend/src/store/index.js)

## 5) Frontend Flows (How It Is Used)

### 5.1 Sign up and verify
1. User signs up from Auth page
2. Backend returns verification-required response
3. User opens verification link or enters token flow
4. `verify-email` marks account as verified
5. User can now login

### 5.2 Login + optional 2FA
1. User submits email/password (+ remember me)
2. If 2FA disabled: login returns auth payload
3. If 2FA enabled: login returns `requiresTwoFactor=true` + temporary token
4. User submits 6-digit TOTP code to `login/2fa`
5. Backend issues session + access token

### 5.3 Session restore and refresh
1. On app load, frontend calls `/refresh`
2. If valid refresh cookie + CSRF header, backend rotates session credentials
3. Frontend keeps access token in app state and schedules renewal
4. On failure, app clears session and redirects to `/auth`

### 5.4 Password reset
1. User requests reset link by email
2. Backend returns generic success response (prevents account enumeration)
3. User opens reset page with token
4. New password is set and all sessions are revoked

### 5.5 Session management and audit review
1. User opens `/security`
2. Frontend fetches active sessions + audit logs
3. User may revoke one session or revoke-all
4. UI updates and logs capture those events

## 6) API Endpoint Summary

Auth API base path: `/api/auth`

Implemented endpoints:
- `POST /register`
- `POST /verify-email`
- `POST /resend-verification`
- `POST /login`
- `POST /login/2fa`
- `POST /refresh`
- `POST /logout`
- `GET /me`
- `GET /sessions`
- `DELETE /sessions/:sessionId`
- `POST /sessions/revoke-all`
- `POST /forgot-password`
- `POST /reset-password`
- `GET /audit-logs`
- `GET /security`
- `POST /2fa/setup`
- `POST /2fa/enable`
- `POST /2fa/disable`

Route reference:
- [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js)

## 7) Configuration You Must Take Care Of

### 7.1 Environment variables

Recommended variables:
- `NODE_ENV=production` in production
- `PORT=4000` (or your chosen backend port)
- `FRONTEND_URL=https://your-frontend-domain` (must match browser origin)
- `JWT_SECRET=<strong-random-secret>`
- `ACCESS_TOKEN_TTL=15m` (or chosen short TTL)

Where used:
- [backend/src/middleware/auth.js](backend/src/middleware/auth.js)
- [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js)
- [backend/src/app.js](backend/src/app.js)

Important note:
- Access token `expiresAt` is currently computed with a fixed `15m` constant (`ACCESS_TOKEN_TTL_MS`).
- If you change `ACCESS_TOKEN_TTL`, update the corresponding millisecond calculation to remain consistent.

### 7.2 CORS and cookies

Required for browser refresh flow:
1. Backend must enable `credentials: true` CORS
2. Frontend requests must send `credentials: 'include'`
3. `FRONTEND_URL` must exactly match your frontend origin
4. In production, cookies become `secure: true`; ensure HTTPS is enabled

### 7.3 Proxy/load balancer actions

If behind reverse proxy:
1. Preserve client IP headers (`X-Forwarded-For`) for rate-limit/audit accuracy
2. Ensure HTTPS termination and secure cookie forwarding
3. Consider trust proxy settings if needed in your deployment topology

## 8) Security Controls and Tunables

Current hardcoded security constants (auth routes):
- Login lockout threshold: 5 failed attempts
- Lockout duration: 30 minutes
- Standard session TTL: 8 hours
- Remember-me session TTL: 30 days
- Email verification token TTL: 24 hours
- Password reset token TTL: 1 hour

Current rate limits (rate-limit middleware):
- Generic auth requests: 10 per 15 minutes
- Login attempts: 5 per 15 minutes (skip successful requests)
- Signup attempts: 5 per hour (skip successful requests)
- Password reset requests: 5 per hour

Recommended action:
- Move these values to environment variables so operations can tune without code changes.

## 9) Operational Actions (Production Checklist)

Before go-live, complete these actions:
1. Replace in-memory stores with persistent DB tables (users, sessions, tokens, audit logs).
2. Use a managed email service (SES/SendGrid/Postmark) for verification and reset emails.
3. Set a strong `JWT_SECRET` and rotate it with a planned strategy.
4. Ensure HTTPS everywhere so secure cookies work.
5. Add log retention and monitoring/alerting on suspicious auth activity.
6. Add admin/security dashboards for lockouts and high failure rates.
7. Add backup and restore strategy for auth-related data.
8. Add integration tests for auth flows and edge cases.

## 10) Known Gaps / Improvements

Current implementation is functionally complete for Phase 1, but these are important upgrades:
1. Persistence gap: all auth/session/audit state is in-memory and resets on server restart.
2. Email delivery gap: verification/reset uses dev preview responses, not real email transport.
3. Configurability gap: lockout/rate/session constants are mostly hardcoded.
4. Access-token TTL consistency gap: static ms helper should track configured TTL.
5. Cookie hardening options can be expanded (for example stricter sameSite based on deployment).

## 11) Quick Test Plan

Use this to validate deliverables quickly:
1. Register a new user, verify email, login successfully.
2. Attempt login with wrong password repeatedly and confirm lockout response.
3. Request password reset, reset password, confirm old sessions are revoked.
4. Login with remember-me and verify extended session expiry.
5. Open Security Center, revoke one session, then revoke-all.
6. Confirm audit logs contain entries for register/login/logout/reset/session actions.
7. Validate refresh flow survives page reload and auto-refreshes token before expiry.

## 12) File Map

Backend auth core:
- [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js)
- [backend/src/middleware/auth.js](backend/src/middleware/auth.js)
- [backend/src/middleware/rate-limit.js](backend/src/middleware/rate-limit.js)
- [backend/src/store/index.js](backend/src/store/index.js)
- [backend/src/app.js](backend/src/app.js)

Frontend auth/session flows:
- [frontend/src/lib/api.ts](frontend/src/lib/api.ts)
- [frontend/src/components/pages/AuthPage.tsx](frontend/src/components/pages/AuthPage.tsx)
- [frontend/src/components/pages/VerifyEmailPage.tsx](frontend/src/components/pages/VerifyEmailPage.tsx)
- [frontend/src/components/pages/ResetPasswordPage.tsx](frontend/src/components/pages/ResetPasswordPage.tsx)
- [frontend/src/components/pages/SecuritySettingsPage.tsx](frontend/src/components/pages/SecuritySettingsPage.tsx)
- [frontend/src/App.tsx](frontend/src/App.tsx)
