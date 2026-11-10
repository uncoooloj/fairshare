# Hackathon MFA simulation

For synthetic hackathon accounts only, set `HACKATHON_MFA_SIMULATION=true` on a **SANDBOX** API. Leave it unset for normal TOTP. Startup rejects simulation in DEMO, with `NODE_ENV=production`, or with `PAYPAL_ENV=live`.

The settings screen explicitly labels simulation. Setup, sign-in and disabling accept any nonempty value up to 80 characters. Password verification, setup expiry, rate limits and session revocation remain enforced. No recovery codes are presented. This is **not account protection** and must not be used with real accounts.

Simulation records are separate from authenticators. Existing real authenticator records always require real factors. Turning simulation off blocks sign-in for enrolled simulation accounts until the operator resets those synthetic accounts; it never silently removes a factor requirement.

OCR is independent: enabling this flag does not enable OCR or send documents anywhere.
