# MECHAT — Netlify migration

## Architecture
- Frontend: React + Vite PWA.
- Authentication: existing Firebase Authentication (email/password and Google OAuth) retained for this first hosting migration.
- Database and encrypted attachment storage: existing Appwrite project in Singapore; no Firebase database.
- API: Netlify Functions, routed at `/api/*`.
- Message bodies and attachments are encrypted on the client before storage. The service worker caches only the application shell/assets, not API responses or message history. Device cryptographic keys remain on the device.

## Required Netlify environment variables
- `APPWRITE_API_KEY`: server-only Appwrite key with the required TablesDB and Storage permissions for the existing MECHAT database and media bucket.
- `TURN_URL` and `TURN_SHARED_SECRET`: optional TURN settings. Without these, calls use public STUN only.

The Firebase web configuration in the frontend is a public client configuration. Do not put service-account credentials or Appwrite API keys in frontend code.

## Build
`npm install && npm run build`

## Verification required
This is a hosting/API-runtime port, not a claim that every product feature is complete. Verify Appwrite schema compatibility, authentication, direct and group delivery, attachments, delivery receipts, and WebRTC on two separate devices before switching users to this deployment.
