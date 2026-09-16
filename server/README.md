# Jharkhand Samadhan Setu — Server

Express API backed by MongoDB Atlas, plus Cloudinary for grievance photo
evidence (no files ever touch local disk).

## 1. Before you run this

`.env` already has real credentials in it for both services, pasted during
setup — rotate both once you've confirmed everything works:

1. **Cloudinary**: `.env` is missing your cloud name (wasn't shared with me).
   Dashboard → top-left, next to your account name (e.g. `dxyz1234a`) →
   paste over `REPLACE_WITH_YOUR_CLOUD_NAME`. Then Settings → Security →
   regenerate the API secret, update `.env`.
2. **MongoDB Atlas**: Database Access → edit `shohanmondalofficial_db_user`
   → Edit Password → generate a new one → update `MONGODB_URI` in `.env`.
   Also check Network Access isn't wide open (`0.0.0.0/0`) once you're done
   testing — restrict it to your actual IP for anything beyond local dev.
3. **Resend (email OTP)**: `EMAIL_FROM` is currently
   `Jharkhand Samadhan Setu <onboarding@resend.dev>` — Resend's *shared test
   sender*. It only delivers to the address that owns the Resend account; every
   other recipient is rejected by Resend with
   "Invalid `to` field. Please use our testing email address instead".
   That is why email OTP can appear to "fail to send" even when the API is
   perfectly healthy. To send OTPs to real citizens:

   - verify a domain at resend.com → Domains, then set
     `EMAIL_FROM="Jharkhand Samadhan Setu <no-reply@your-verified-domain>"`, **or**
   - keep the test sender and only test with the Resend account owner's address.

   The server now logs a warning on boot when it detects the test sender, and
   the `POST /api/auth/send-email-otp` error response includes the exact message
   from Resend (`detail`) so this is never guesswork again.

`.env` is git-ignored. Never put real keys in `.env.example` or in any file
under `site/` — anything in `site/` ships to the browser, where a secret is
no longer a secret.

## 2. Install & run

```bash
cd server
npm install
npm run dev        # starts on http://localhost:4000 with auto-reload
```

For deployment, copy `.env.example` to `.env`, set `NODE_ENV=production`, use
the public site origin in `CORS_ORIGIN`, and configure a verified Resend sender
domain. The readiness probe is `GET /api/ready`; it returns HTTP 200 only when
MongoDB is connected. Use `npm ci` and `npm start` in the deployment service.

Health check:

```bash
curl http://localhost:4000/api/health
```

## 3. Load demo data

```bash
npm run seed
```

Pushes the same 4 grievances the frontend currently fakes with
`localStorage` (`JH-2024-10312` etc.) into the real database, so the
homepage tracker keeps working once it's pointed at this API. Safe to
re-run — it upserts by `id`, never duplicates.

## 4. Try the grievance endpoints

```bash
curl http://localhost:4000/api/problems
curl http://localhost:4000/api/problems/JH-2024-10312
curl -X PATCH http://localhost:4000/api/problems/JH-2024-10312/bump

curl -X POST http://localhost:4000/api/problems \
  -H "Content-Type: application/json" \
  -d '{"title":"Streetlight not working","description":"Main road streetlight has been off for a week","district":"Ranchi","scaleOfImpact":"Specific Neighbourhood","durationDays":7}'
```

`POST` auto-fills `category` (keyword-based, same placeholder logic as the
frontend's `fakeCategorize`), `id`, `status`, `priorityScore` and
`createdAt` — you only send what a citizen actually types into the form.

## 5. Try an upload

```bash
curl -X POST http://localhost:4000/api/upload/grievance-photos \
  -F "photos=@/path/to/photo.jpg"
```

Response:

```json
{ "files": [{ "url": "https://res.cloudinary.com/...", "publicId": "jss/grievance-evidence/...", "width": 1600, "height": 1200, "bytes": 214031 }] }
```

Delete a photo (e.g. citizen removes it before final submit):

```bash
curl -X DELETE "http://localhost:4000/api/upload?publicId=jss/grievance-evidence/abc123"
```

## What's in here

| File | Purpose |
|---|---|
| `src/server.js` | Entry point: loads `.env`, connects to MongoDB, then starts listening |
| `src/app.js` | Express app: CORS, JSON body parsing, route mounting, error handler |
| `src/config/db.js` | Mongoose connection to Atlas |
| `src/config/cloudinary.js` | Cloudinary SDK config, read from env only |
| `src/config/resend.js` | Resend SDK config, read from env only |
| `src/models/Problem.js` | Grievance schema — same fields as `site/js/mock-data.js` |
| `src/models/EmailOtp.js` | Hashed OTP codes, auto-deleted 10 min after issue (MongoDB TTL index) |
| `src/utils/categorize.js` | Same placeholder categorizer/priority-scorer as `site/js/api.js` |
| `src/utils/otp.js` | 6-digit code generation + SHA-256 hashing |
| `src/middleware/upload.js` | Multer: in-memory storage, image-only, 5MB/file, max 5 files |
| `src/routes/problems.js` | `GET /api/problems`, `GET /:id`, `POST /`, `PATCH /:id/status`, `PATCH /:id/bump` |
| `src/routes/upload.js` | `POST /api/upload/grievance-photos`, `DELETE /api/upload` |
| `src/routes/auth.js` | `POST /api/auth/send-email-otp`, `POST /api/auth/verify-email-otp` |
| `src/models/Citizen.js` | Real citizen accounts — name, email, phone |
| `src/routes/citizens.js` | `POST /api/citizens/find-or-create` — used by both register and login pages after OTP succeeds |
| `scripts/seed.js` | Loads the demo grievances into Atlas — `npm run seed` |

`GET /api/health` now also reports `db: "connected"` once Atlas is wired up.

`GET /api/ready` is intended for load balancers and deployment health checks.
The server also applies security headers, JSON request limits, a global request
rate limit, explicit OTP expiry checks, and graceful shutdown handling.

### Email OTP — how it's protected

- Codes are hashed (SHA-256) before they're stored — nobody reading the
  database directly can see a valid code
- The comparison is constant-time (`crypto.timingSafeEqual`), so a response
  can't be used to guess the hash one character at a time
- 30-second cooldown between resend requests per email
- Codes expire after 10 minutes (MongoDB deletes them automatically — no
  cleanup job needed)
- Max 5 wrong guesses before a code is invalidated and a new one is required
- Single-use — a correct code is deleted the moment it's verified
- One live code per address, enforced by the `email_unique` index. It is named
  explicitly instead of using `unique: true` (which would generate the name
  `email_1`) because databases created by an earlier version of this model
  already hold a *non-unique* `email_1`, and MongoDB refuses to redefine an
  index under an existing name. If index creation ever complains about
  duplicates, clear them with
  `db.emailotps.aggregate([{ $group: { _id: "$email", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])`
  and delete the extra documents.
- Index builds are awaited at boot and reported as warnings rather than
  crashing the process (`src/server.js`).

### Frontend wiring already done

**Where the API lives.** Every page goes through `site/js/api.js`, which reads an
optional `window.JSS_API_BASE_URL` override and accepts it in *either* form,
with or without the `/api` suffix:

```html
<script>window.JSS_API_BASE_URL = "https://your-api.example.com";</script>
<!-- or, equally valid: -->
<script>window.JSS_API_BASE_URL = "https://your-api.example.com/api";</script>
```

With no override: pages served from `localhost`/`127.0.0.1`/`file://` talk to
`http://<host>:4000`, and a deployed page calls `/api/...` on its own origin.
Pages must use `API.apiUrl("/path")` / `API.request("/path")` rather than
building that URL by hand — a hand-built base URL is what previously made the
citizen login/register pages request `/api/api/auth/...` and report a generic
fetch failure while every other page worked.

`site/citizen/login.html` — the Email tab calls the auth routes above for real,
then `/api/citizens/find-or-create` so a real account exists in the database,
not just a local session. The Mobile tab sends a real SMS OTP through Firebase
(`site/js/firebase-config.js`). If Firebase can't send (Blaze plan not enabled,
SMS quota used up, domain not authorised, …) the toast says exactly why and the
page falls back to the local demo code `252525` so the demo never dead-ends.
**The demo code is a demo affordance, not security** — with a working Firebase
project the SMS code is the one that is verified.

`site/citizen/register.html` — same OTP mechanics as login plus a required Full
Name field. Calls the same `find-or-create` endpoint with the name attached, so
registering and logging in converge on one real account instead of being two
separate systems.

**Resend countdown / button state.** `startOtpCountdown()` in `site/js/shared.js`
owns the "Get OTP" button lock (and `stopOtpCountdown()` releases it when a send
fails), so the button can no longer get stuck disabled.

## Not done yet

- No auth on the grievance/upload routes yet — `POST /api/problems` and
  the upload route should require a valid session once login is fully
  wired everywhere, so they can't be spammed anonymously. `PATCH
  .../status` should be restricted to government officer accounts only.
- CORS in development allows any `localhost`/`127.0.0.1` port (plus
  `Origin: null` from `file://` pages), so Live Server on 5500, a preview on
  3000 and `python -m http.server` on 8000 all work. In production only the
  explicit `CORS_ORIGIN` list is honoured, so set it to the real site origin
  before deploying.
- Rate limits: 300 requests / 15 min per IP across the API, and 60 / 15 min on
  `/api/auth` (each OTP send is a real e-mail). `/api/health` and `/api/ready`
  sit *before* the limiter so monitoring can't lock itself out.
- Student/startup collaboration data (`SEED_STUDENT_PROJECTS`,
  `SEED_STARTUP_COLLABS` in `mock-data.js`) isn't in the database yet —
  say the word and I'll add those models + routes the same way.
