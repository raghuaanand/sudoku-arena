# Sudoku Arena - Deployment & Testing Guide

## Table of Contents
1. [Local Development Setup](#local-development-setup)
2. [Environment Variables](#environment-variables)
3. [Testing Locally](#testing-locally)
4. [Vercel Deployment](#vercel-deployment)
5. [Pre-Deployment Checklist](#pre-deployment-checklist)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Troubleshooting](#troubleshooting)

---

## Local Development Setup

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- Redis (optional, for queue persistence)
- npm or pnpm

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Database Setup
```bash
# Create PostgreSQL database
createdb suduko

# Or using psql
psql -U postgres -c "CREATE DATABASE suduko;"

# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

### Step 3: Environment Configuration
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values
nano .env
```

### Step 4: Start Development Server
```bash
# Option 1: Next.js only (no WebSocket support)
npm run dev

# Option 2: With Socket.IO server (for multiplayer)
npm run dev:full
# Or run in separate terminals:
npm run dev          # Port 3000
node server.js       # Port 3003
```

---

## Environment Variables

### Required for Local Development

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/suduko` |
| `NEXTAUTH_SECRET` | Auth encryption key | Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | App base URL | `http://localhost:3000` |

### Required for Payments (Test Mode)

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `RAZORPAY_KEY_ID` | API Key ID | [Razorpay Dashboard](https://dashboard.razorpay.com/app/keys) |
| `RAZORPAY_KEY_SECRET` | API Key Secret | Same as above |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Public key for frontend | Same as RAZORPAY_KEY_ID |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signing secret | Dashboard > Webhooks > Secret |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis for queue/state | Falls back to in-memory |
| `CRON_SECRET` | Auth for cron jobs | Required for Vercel crons |
| `SOCKET_PORT` | WebSocket server port | `3003` |

---

## Testing Locally

### 1. Test Authentication
```bash
# Start the app
npm run dev

# Open browser
open http://localhost:3000

# Test flows:
# - Sign up with email/password
# - Sign in
# - OAuth (if configured)
```

### 2. Test Wallet & Payments

#### Mock Payment Mode (Development)
The app uses mock payments in development. When `RAZORPAY_KEY_ID` starts with `rzp_test_`:

```bash
# Add money flow:
1. Go to /wallet
2. Enter amount (e.g., ₹500)
3. Click "Add Money"
4. Payment auto-completes in mock mode
5. Verify balance updated
```

#### Test with Razorpay Test Mode
1. Use test card: `4111 1111 1111 1111`
2. Any future expiry date
3. Any CVV (3 digits)
4. OTP: `1234` (Razorpay test mode)

### 3. Test Matchmaking Queue

```bash
# Open two browser windows (or incognito)

# Window 1: Login as User A
# Window 2: Login as User B

# Both users:
1. Go to Dashboard
2. Click "Prize Match" (₹100 entry)
3. Wait for match

# Verify:
- Both users matched
- Entry fees deducted (₹100 each)
- Prize pool shown (₹180 after 10% fee)
```

### 4. Test Game Engine

```bash
# In a matched game:
1. Make correct moves - verify +10 points
2. Make incorrect moves - verify -5 points
3. Let timer run - verify timeout handling
4. Complete puzzle - verify winner determined
5. Check wallet - verify winnings credited
```

### 5. Test Webhooks Locally

Use [ngrok](https://ngrok.com/) or [localtunnel](https://localtunnel.me):

```bash
# Install ngrok
brew install ngrok

# Expose local server
ngrok http 3000

# Copy ngrok URL (e.g., https://abc123.ngrok.io)
# Add to Razorpay Dashboard > Webhooks:
# URL: https://abc123.ngrok.io/api/payments/webhook
# Events: payment.authorized, payment.captured, payment.failed, refund.processed
```

### 6. Run TypeScript Check
```bash
npx tsc --noEmit
```

### 7. Run Linting
```bash
npm run lint
```

---

## Vercel Deployment

### Step 1: Connect Repository
1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Select "Next.js" framework

### Step 2: Configure Environment Variables

In Vercel Dashboard > Project > Settings > Environment Variables:

```
# Required
DATABASE_URL=postgresql://...?sslmode=require
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=https://your-app.vercel.app

# Razorpay (use LIVE keys for production!)
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxx

# Cron job auth
CRON_SECRET=your-cron-secret

# Optional
REDIS_URL=redis://...
```

### Step 3: Database Setup

#### Option A: Supabase (Recommended)
1. Create project at [supabase.com](https://supabase.com)
2. Go to Settings > Database > Connection string
3. Copy "URI" for `DATABASE_URL`
4. Copy "Direct URL" for `DIRECT_URL` (for migrations)

#### Option B: Neon
1. Create project at [neon.tech](https://neon.tech)
2. Copy connection string

#### Run Migrations
```bash
# Set production DATABASE_URL locally
export DATABASE_URL="your-production-url"

# Run migrations
npx prisma migrate deploy
```

### Step 4: Configure Razorpay Webhook

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com)
2. Webhooks > Add New Webhook
3. URL: `https://your-app.vercel.app/api/payments/webhook`
4. Select events:
   - `payment.authorized`
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
5. Copy webhook secret to Vercel env vars

### Step 5: Deploy
```bash
# Push to trigger deployment
git push origin main

# Or trigger manually in Vercel dashboard
```

---

## Pre-Deployment Checklist

### Code Quality
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npm run lint` passes
- [ ] All tests pass (if applicable)
- [ ] No console.log statements in production code
- [ ] Error handling for all API routes

### Environment
- [ ] All required env vars set in Vercel
- [ ] Using LIVE Razorpay keys (not test)
- [ ] NEXTAUTH_URL matches your domain
- [ ] DATABASE_URL points to production database

### Database
- [ ] Migrations run on production database
- [ ] Prisma client generated
- [ ] No pending migrations

### Security
- [ ] NEXTAUTH_SECRET is unique and strong
- [ ] CRON_SECRET is set for maintenance jobs
- [ ] RAZORPAY_WEBHOOK_SECRET is set
- [ ] OAuth redirect URIs updated for production domain
- [ ] No secrets in client-side code

### Razorpay
- [ ] Live API keys configured
- [ ] Webhook URL points to production
- [ ] Webhook secret configured
- [ ] Test payment flow works

### Vercel Config
- [ ] `vercel.json` has correct cron configuration
- [ ] Function durations set appropriately
- [ ] No build errors

---

## Post-Deployment Verification

### 1. Health Check
```bash
curl https://your-app.vercel.app/api/health
# Should return: {"status":"ok",...}
```

### 2. Auth Flow
- [ ] Sign up works
- [ ] Sign in works
- [ ] Session persists

### 3. Payment Flow
- [ ] Can add money with real card
- [ ] Balance updates correctly
- [ ] Transaction history shows

### 4. Game Flow
- [ ] Can create single player game
- [ ] Can join matchmaking queue
- [ ] Matches created when 2 players queue
- [ ] Entry fees deducted
- [ ] Winnings credited after game

### 5. Cron Job
Check Vercel logs for cron execution:
```
Functions > /api/cron/maintenance
```

---

## Troubleshooting

### Database Connection Issues
```bash
# Test connection
npx prisma db pull

# Common fixes:
# - Add ?sslmode=require to DATABASE_URL
# - Use connection pooler URL for serverless
# - Check IP allowlist in database dashboard
```

### Prisma Client Not Found
```bash
# Regenerate after deployment
npx prisma generate
```

### Webhook Not Receiving Events
1. Check Razorpay Dashboard > Webhooks > Activity
2. Verify URL is correct
3. Check webhook secret matches
4. Look for errors in Vercel logs

### Socket.IO Not Working
- Vercel doesn't support WebSocket upgrade
- Uses long-polling fallback automatically
- For real-time games, consider:
  - Separate WebSocket server (Railway, Render)
  - Pusher/Ably for real-time events

### Payment Failures
1. Check Razorpay Dashboard for error details
2. Verify API keys are correct
3. Check webhook is receiving events
4. Look for errors in Vercel function logs

### Cron Jobs Not Running
1. Check `vercel.json` cron configuration
2. Verify CRON_SECRET is set
3. Check Vercel Functions logs
4. Crons only run in production (not preview)

---

## Architecture Notes

### Currency
- All amounts stored in **paisa** (INR × 100)
- Frontend converts to rupees for display
- API accepts/returns paisa

### Wallet Model
```
balance        - Total balance (paisa)
escrowBalance  - Locked in active matches (paisa)
availableBalance = balance - escrowBalance
```

### Match Flow
```
1. Player joins queue (POST /api/queue)
2. Entry fee locked in escrow
3. When matched, game starts
4. Moves validated on server (+10 correct, -5 wrong)
5. Game ends (timeout/completion)
6. Winner determined, escrow released
7. 10% platform fee deducted
```

### Transaction Types
- `DEPOSIT` - Money added via Razorpay
- `WITHDRAWAL` - Money withdrawn
- `ENTRY_FEE` - Recorded when joining paid match
- `ESCROW_LOCK` - Funds locked for match
- `ESCROW_RELEASE` - Funds returned after match
- `WINNINGS` - Prize money credited
- `REFUND` - Refunded amount
- `PLATFORM_FEE` - Platform's cut

---

## Support

For issues:
1. Check Vercel logs
2. Check browser console
3. Check network tab for API errors
4. Review this guide's troubleshooting section
