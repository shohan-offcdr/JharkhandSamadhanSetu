# Security Policy

## 🚨 Critical: API Key Exposure

**If you are reading this, API keys may have been exposed in git history.**

### Immediate Actions Required

1. **If real API keys were ever committed to this repository:**
   - **XAI/Grok Key**: Delete and regenerate at [console.x.ai](https://console.x.ai)
   - **Google Gemini Key**: Delete and regenerate at [Google AI Studio](https://aistudio.google.com)
   - **Cloudinary Keys**: Regenerate at [Cloudinary Console](https://cloudinary.com/console)
   - **MongoDB URI**: Change database password at MongoDB Atlas

2. **After rotating keys:**
   - Update `server/.env` with new keys
   - **Never commit `.env` files** - they are gitignored for this reason

### Current Status

- The `.env.example` file uses placeholder values only
- Real `.env` files are gitignored
- Commit `cbbb2db` cleaned up the example file to use placeholders

## Environment Variables

### Required (Production)
| Variable | Description | Get From |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | MongoDB Atlas |
| `RESEND_API_KEY` | Email OTP service | [resend.com](https://resend.com) |
| `CLOUDINARY_*` | File upload service | [cloudinary.com](https://cloudinary.com) |
| `AUTH_SECRET` | JWT signing secret (32+ chars) | `openssl rand -base64 32` |

### Optional (AI Features)
| Variable | Description | Get From |
|----------|-------------|----------|
| `XAI_API_KEY` | Grok API (primary AI provider) | [console.x.ai](https://console.x.ai) |
| `GEMINI_API_KEY` | Google Gemini (fallback AI) | [Google AI Studio](https://aistudio.google.com) |
| `OPENAI_API_KEY` | OpenAI embeddings (optional) | [platform.openai.com](https://platform.openai.com) |

## Demo Credentials

For development only. Change immediately in any shared environment.

| Portal | Email | Default Password |
|--------|-------|-----------------|
| Government | `officer@jharkhand.gov.in` | `Jharkhand@2026!` (or `SEED_GOVERNMENT_PASSWORD` env var) |
| Startup | `partner@example.com` | `Partner@2026!` (or `SEED_STARTUP_PASSWORD` env var) |

Run with custom passwords:
```bash
SEED_GOVERNMENT_PASSWORD=your-secret SEED_STARTUP_PASSWORD=your-secret npm run seed
```

## Security Best Practices

1. **Never commit secrets**: `.env`, `.env.local`, `.env.production` are gitignored
2. **Rotate exposed keys immediately**: If a key is ever in a commit, chat, or log, consider it compromised
3. **Use environment-specific keys**: Different keys for dev/staging/production
4. **Limit API key permissions**: Use keys with minimal required scopes
5. **Enable Firebase Security Rules**: Client-side Firebase config is normal, but protect data with rules
6. **Use strong passwords**: Minimum 8 characters, preferably 12+ with mixed case/numbers/symbols
7. **Review dependencies**: Run `npm audit` regularly

## Firebase Security

The Firebase config in `site/js/firebase-config.js` is **client-side only** and safe to expose. Firebase security is enforced by:

1. **Security Rules** in Firebase Console (not in this codebase)
2. **App Check** (recommended for production)
3. **reCAPTCHA** on OTP flows

Ensure Firebase Security Rules are properly configured before production use.

## Vulnerability Reporting

If you discover a security issue, please report it responsibly:

- **Email**: [your-email@example.com]
- **Do NOT open public issues** for security vulnerabilities

## Environment Setup

```bash
# Copy example env file
cd server
cp .env.example .env

# Generate a secure AUTH_SECRET
openssl rand -base64 32

# Edit .env with your real values
# NEVER commit .env
```
