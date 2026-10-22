# Users API Documentation

## Overview
This API provides endpoints for user account management, including user deletion with complete cleanup of associated data while preserving documents.

## Endpoints

### 1. Delete Own Account
**Endpoint:** `DELETE /api/users/me`

**Authentication:** Required (Bearer token or session cookie)

**Description:** Allows authenticated users to delete their own account. Requires password confirmation for security.

**Request Body:**
```json
{
  "confirmPassword": "user_password_here"
}
```

**Success Response (200):**
```json
{
  "message": "User account successfully deleted.",
  "deletionDetails": {
    "userDeleted": true,
    "relationsDeleted": {
      "authSessions": 5,
      "userBilling": 1,
      "userUsage": 12,
      "tenantMembership": 1,
      "tenantsInvite": 0,
      "auditLogs": 25
    }
  }
}
```

**Error Responses:**
- **400:** Password confirmation is required
- **401:** Invalid password
- **404:** User not found
- **500:** Server error during deletion

---

### 2. Delete User Account (Admin/Authorized)
**Endpoint:** `DELETE /api/users/:userId`

**Authentication:** Required (Bearer token or session cookie)

**Authorization:** 
- Users can only delete their own account (userId must match authenticated user)
- Admins can delete any user account

**Description:** Deletes a specific user account and all their associated data except documents.

**URL Parameters:**
- `userId` (string, required): The ID of the user to delete

**Success Response (200):**
```json
{
  "message": "User account successfully deleted.",
  "deletionDetails": {
    "userDeleted": true,
    "relationsDeleted": {
      "authSessions": 3,
      "userBilling": 1,
      "userUsage": 8,
      "tenantMembership": 1,
      "tenantsInvite": 2,
      "auditLogs": 18
    }
  }
}
```

**Error Responses:**
- **403:** Insufficient permissions (non-admin trying to delete another user)
- **404:** User not found
- **500:** Server error during deletion

---

## What Gets Deleted

When a user account is deleted, the following data is permanently removed:

### ✅ Deleted Relations
1. **Auth Sessions** - All active login sessions
2. **User Billing** - Billing account information
3. **User Usage** - Monthly usage records and quotas
4. **Tenant Membership** - User's access to tenants/workspaces
5. **Tenant Invites** - Invitations sent by the user
6. **Audit Logs** - Logs where the user is the subject

### ❌ Preserved Data
1. **Documents** - All documents remain in the system
2. **Comments** - Comments stay intact (preserves history)
3. **Versions** - Document versions are preserved
4. **Todos** - Task items remain accessible

**Note:** Documents remain so that other team members can access shared documents. Comments and versions are preserved to maintain document history and audit trail.

---

## Audit Logging

All user deletion operations are logged to the audit log with the following details:

**Success Log:**
```json
{
  "action": "user-deletion",
  "status": "success",
  "deletedUserId": "user-id-123",
  "metadata": {
    "authSessions": 5,
    "userBilling": 1,
    "userUsage": 12,
    "tenantMembership": 1,
    "tenantsInvite": 0,
    "auditLogs": 25
  }
}
```

**Failure Attempts:**
- Failed password confirmation attempts
- Unauthorized deletion attempts (non-admin trying to delete other users)
- System errors during deletion

---

## Security Considerations

1. **Password Confirmation Required** - Users must provide their password to delete their own account
2. **Authorization Checks** - Non-admins cannot delete other users' accounts
3. **Atomic Transactions** - All deletions happen in a single transaction; if any part fails, nothing is deleted
4. **Comprehensive Audit Trail** - All deletion attempts are logged

---

## Examples

### Delete Your Own Account (JavaScript)
```javascript
const response = await fetch('/api/users/me', {
  method: 'DELETE',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include', // Include session cookie
  body: JSON.stringify({
    confirmPassword: 'user_password'
  })
});

const result = await response.json();
if (response.ok) {
  console.log('Account deleted:', result.deletionDetails);
} else {
  console.error('Deletion failed:', result.error);
}
```

### Delete Another User (Admin - cURL)
```bash
curl -X DELETE http://localhost:4000/api/users/user-id-123 \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json"
```

---

## Data Integrity

**Transaction Safety:** All user data deletion is wrapped in a Prisma transaction. If any deletion fails:
- The entire operation is rolled back
- No partial deletions occur
- An error is returned to the client

**Cascade Prevention:** The deletion does not cascade to documents or related content:
- Documents remain intact
- Comments and versions stay in the system
- Other users' access is not affected

---

## Rate Limiting

User deletion endpoints may be subject to rate limiting to prevent abuse. Check response headers for rate limit information.

---

## Future Enhancements

Potential improvements:
1. Soft delete with recovery window (30 days)
2. Data export before deletion
3. Anonymization option (keep documents but anonymize user info)
4. Bulk user deletion (admin)
5. Scheduled deletion (delete after confirmation wait period)
