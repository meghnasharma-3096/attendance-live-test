# Attendance Live Test

A QR-code-based classroom attendance system built with React (Vite) and Supabase.

- **Login** — role-based auth via a Postgres `verify_login` RPC
- **Student dashboard** — session-by-session attendance history
- **Professor dashboard** — rotating-QR live session with GPS reference, headcount via Supabase Realtime, and manual override for students without a device
- **Scan flow** — device fingerprinting, GPS distance check, and duplicate/expiry guards
- **Admin dashboard** — read-only course roster and session list
- **Anomaly detection** — on-demand check for shared-device usage and flagged records

## Development

```bash
npm install
npm run dev
```

Requires a `.env` file with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).

## Deployment

Deploys automatically to GitHub Pages via GitHub Actions on every push to `main`.
