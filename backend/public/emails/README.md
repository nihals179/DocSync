# Email Templates

Professional MJML email templates for DocSync. These templates are compiled to HTML at runtime.

## Available Templates

### 1. Welcome Email
**Used for:** New user registration (when email verification is bypassed)
**File:** `welcome.mjml`
**Variables:** `{{userName}}`

---

### 2. Email Verification
**Used for:** Email address verification during registration
**File:** `verify-email.mjml`
**Variables:** `{{userName}}`, `{{verificationLink}}`
**TTL:** 24 hours

---

### 3. Password Reset
**Used for:** Password reset requests
**File:** `reset-password.mjml`
**Variables:** `{{userName}}`, `{{resetLink}}`
**TTL:** 1 hour

---

## How It Works

1. **MJML Source** — Templates are written in MJML format (`.mjml` files)
2. **Runtime Compilation** — The email utility compiles MJML to HTML when sending emails
3. **Auto Plain Text** — Plain text version is automatically generated from HTML
4. **Variable Substitution** — Template variables like `{{userName}}` are replaced before sending

## Using MJML Templates

### Email Utility Integration
```javascript
const { 
  sendWelcomeEmail, 
  sendVerificationEmail, 
  sendPasswordResetEmail 
} = require('../utils/email');

// Send verification email
await sendVerificationEmail(
  'user@example.com', 
  'https://app.com/verify?token=xyz',
  'John Doe' // Optional: user name
);

// Send password reset email
await sendPasswordResetEmail(
  'user@example.com', 
  'https://app.com/reset?token=abc',
  'John Doe' // Optional: user name
);

// Send welcome email
await sendWelcomeEmail('user@example.com', 'John Doe');
```

## Editing Templates

### To Update a Template:

1. Open the `.mjml` file (e.g., `welcome.mjml`)
2. Edit the MJML markup
3. Save the file
4. Changes take effect on next email send (recompiled automatically)

### MJML Reference:
- Docs: https://mjml.io/documentation
- Components: `<mj-section>`, `<mj-column>`, `<mj-text>`, `<mj-button>`, etc.
- Responsive by default — media queries handled automatically

## Email Client Support

Optimized for:
- Gmail (Web, Mobile)
- Outlook (Web, Desktop)
- Apple Mail
- Thunderbird
- Mobile email clients

## Features

- ✅ Responsive design
- ✅ Professional styling
- ✅ Dark mode compatible
- ✅ HTML + Plain text versions
- ✅ Variable substitution
- ✅ Brand-consistent colors
- ✅ Security best practices

## File Structure

```
backend/public/emails/
├── welcome.mjml
├── verify-email.mjml
├── reset-password.mjml
└── README.md
```

---

**Last Updated:** October 22, 2026
