# Email Verification on Login - Frontend Guide

## Overview
When a user tries to login with an unverified email, the backend returns a 403 status with a special response that includes an option to resend the verification email.

## Backend Response (403 - Email Not Verified)

```json
{
  "error": "Please verify your email before signing in.",
  "requiresEmailVerification": true,
  "email": "user@example.com",
  "message": "Check your inbox for a verification link. If you did not receive it, you can request a new one."
}
```

## Frontend Implementation

### 1. Handle Login Error Response

```javascript
async function handleLogin(email, password) {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.status === 403 && data.requiresEmailVerification) {
      // Show email verification screen
      showEmailVerificationPrompt(data);
      return;
    }

    if (!response.ok) {
      showError(data.error);
      return;
    }

    // Login successful
    handleLoginSuccess(data);
  } catch (error) {
    showError('Login failed. Please try again.');
  }
}
```

### 2. Create Email Verification Prompt Component

```javascript
function showEmailVerificationPrompt(data) {
  // Display a modal or screen with:
  // 1. Message explaining email verification is required
  // 2. The user's email address
  // 3. Resend verification button
  // 4. Link to resend verification

  const modal = document.createElement('div');
  modal.className = 'verification-modal';
  modal.innerHTML = `
    <div class="verification-content">
      <h2>Verify Your Email</h2>
      <p>${data.message}</p>
      <p><strong>Email:</strong> ${data.email}</p>
      
      <div class="verification-actions">
        <button onclick="resendVerificationEmail('${data.email}')">
          Resend Verification Email
        </button>
        <p class="help-text">
          Once you verify your email, you'll be able to log in.
        </p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}
```

### 3. Implement Resend Verification

```javascript
async function resendVerificationEmail(email) {
  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error);
      return;
    }

    // Show success message
    showSuccess('Verification email sent! Check your inbox.');
    
    // Optionally: Show a timer or "didn't receive?" link
    showResendTimer(email);
  } catch (error) {
    showError('Failed to resend verification email. Please try again.');
  }
}
```

### 4. Optional: Add Resend Cooldown

```javascript
function showResendTimer(email) {
  let secondsLeft = 60; // 60 second cooldown
  const button = document.querySelector('[onclick*="resendVerificationEmail"]');
  button.disabled = true;
  button.textContent = `Resend in ${secondsLeft}s`;

  const interval = setInterval(() => {
    secondsLeft--;
    button.textContent = `Resend in ${secondsLeft}s`;

    if (secondsLeft <= 0) {
      clearInterval(interval);
      button.disabled = false;
      button.textContent = 'Resend Verification Email';
    }
  }, 1000);
}
```

## UI/UX Best Practices

### ✅ Do:
1. **Show clear messaging** - Explain why they can't login
2. **Display the email address** - So they know which email to check
3. **Make resend easy** - Single click button to resend
4. **Provide help** - Link to support if they didn't receive email
5. **Show status updates** - Success/error messages for resend
6. **Implement cooldown** - Prevent spam resend attempts

### ❌ Don't:
1. Show technical error codes
2. Bury the resend button
3. Redirect away from login without context
4. Allow unlimited resend attempts
5. Make user re-enter email address

## Example UI Layout

```
┌─────────────────────────────────────┐
│   ⚠️  Verify Your Email             │
├─────────────────────────────────────┤
│                                     │
│  Check your inbox for a             │
│  verification link.                 │
│                                     │
│  Email: user@example.com            │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Resend Verification Email   │   │
│  └─────────────────────────────┘   │
│                                     │
│  Didn't receive it?                 │
│  [Contact Support]                  │
│                                     │
└─────────────────────────────────────┘
```

## Full Example (React)

```jsx
import { useState } from 'react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [isResending, setIsResending] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.status === 403 && data.requiresEmailVerification) {
        setVerificationEmail(data.email);
        return;
      }

      if (!response.ok) {
        setError(data.error);
        return;
      }

      // Login successful - redirect
      window.location.href = '/dashboard';
    } catch (err) {
      setError('Login failed. Please try again.');
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);
      
      setError(''); // Clear error
      alert('Verification email sent! Check your inbox.');
    } catch (err) {
      setError('Failed to resend. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  // Show email verification screen
  if (verificationEmail) {
    return (
      <div className="verification-screen">
        <h2>Verify Your Email</h2>
        <p>Check your inbox for a verification link.</p>
        <p><strong>{verificationEmail}</strong></p>
        
        <button 
          onClick={handleResend}
          disabled={isResending}
        >
          {isResending ? 'Sending...' : 'Resend Verification Email'}
        </button>
        
        <button onClick={() => setVerificationEmail('')}>
          Back to Login
        </button>
      </div>
    );
  }

  // Show login form
  return (
    <form onSubmit={handleLogin}>
      <h2>Login</h2>
      
      {error && <div className="error">{error}</div>}
      
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      
      <button type="submit">Login</button>
    </form>
  );
}
```

## API Endpoints Reference

### Login with Unverified Email
- **URL:** `POST /api/auth/login`
- **Response:** 403 with `requiresEmailVerification: true`
- **Includes:** `email`, `message`

### Resend Verification Email
- **URL:** `POST /api/auth/resend-verification`
- **Body:** `{ "email": "user@example.com" }`
- **Response:** 200 with `message: "Verification email sent successfully."`

### Verify Email
- **URL:** `POST /api/auth/verify-email`
- **Body:** `{ "token": "verification_token_from_email" }`
- **Response:** 200 with `message: "Email verified successfully."`

## Testing

1. Register with a new email
2. Try to login without verifying
3. See "Email not verified" message
4. Click "Resend Verification Email"
5. Check email for new verification link
6. Click link and verify
7. Login successfully

---

**Backend Status:** ✅ Configured and ready
**Frontend:** Needs implementation based on your framework
