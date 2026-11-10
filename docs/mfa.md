# Authenticator MFA

## Operator setup

Configure `FAIRSHARE_MFA_ENCRYPTION_KEY` with a dedicated cryptographically random 32-byte key encoded as Base64. Keep it in authorized server secret storage, never in the repository or browser. Back it up securely alongside the database. Do not change or remove it after users enroll: existing authenticator secrets require that key to decrypt. No key is generated or provisioned by this patch.

Without a valid key, MFA setup is unavailable and the UI says so. An already enabled authenticator is never silently bypassed. Users may still use an unused recovery code if the encryption key is temporarily unavailable.

## User flow

1. Settings → Authenticator security → enter current password → Set up authenticator.
2. Add the displayed setup key to an authenticator app as a time-based six-digit code. No third-party QR service receives the secret.
3. Enter the code to enable. Setup expires in ten minutes; Cancel deletes the pending enrollment.
4. Save the ten recovery codes displayed once. Enabling signs out all existing sessions. Sign in with the password plus the next authenticator code or one unused recovery code.
5. To disable, provide current password and a valid unused factor. Disabling signs out all sessions. To replace an authenticator or replenish recovery codes, disable and enroll again.

## Security properties

- RFC6238 SHA1, six digits, 30-second intervals with one adjacent interval of clock tolerance. A successfully used counter cannot be replayed.
- User-bound AES-256-GCM encryption for authenticator secrets; random nonces. Recovery codes have 80 bits of randomness and only SHA-256 hashes are stored.
- Password and factor are checked before a session is issued. The verification/consumption/session operation is one database transaction.
- Enrollment, activation, disable and login attempts are rate limited. Changes and recovery-code uses are audited without including credentials.
- Password reset does not remove MFA. Losing both the authenticator and every recovery code has no self-service bypass; an operator recovery policy is deliberately not invented.

Tests cover RFC vectors, enrollment expiry, cancellation, ciphertext tampering/user binding, login enforcement, code replay, recovery-code consumption, password-reset non-bypass and session revocation. Testing with a real authenticator app remains part of the browser acceptance walkthrough.
