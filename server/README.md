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

`.env` is git-ignored. Never put real keys in `.env.example` or in any file
under `site/` — anything in `site/` ships to the browser, where a secret is
no longer a secret.

## 2. Install & run

```bash
cd server
npm install
npm run dev        # starts on http://localhost:4000 with auto-reload
```

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

### Email OTP — how it's protected

- Codes are hashed (SHA-256) before they're stored — nobody reading the
  database directly can see a valid code
- 30-second cooldown between resend requests per email
- Codes expire after 10 minutes (MongoDB deletes them automatically — no
  cleanup job needed)
- Max 5 wrong guesses before a code is invalidated and a new one is required
- Single-use — a correct code is deleted the moment it's verified

### Frontend wiring already done

`site/citizen/login.html` — Mobile tab uses real Firebase SMS (needs Blaze
or a test number, see earlier notes). Email tab calls the auth routes above
for real. Both paths now also call `/api/citizens/find-or-create` so a real
account exists in the database, not just a local session.

`site/citizen/register.html` — new page, same OTP mechanics as login plus a
required Full Name field. Calls the same `find-or-create` endpoint with the
name attached, so registering and logging in converge on one real account
instead of being two separate systems. The "Register here" link on the
login page now points here instead of `href="#"`.

## Not done yet

- No auth on the grievance/upload routes yet — `POST /api/problems` and
  the upload route should require a valid session once login is fully
  wired everywhere, so they can't be spammed anonymously. `PATCH
  .../status` should be restricted to government officer accounts only.
- CORS currently only allows `localhost:5500` / `127.0.0.1:5500` (a common
  Live Server port). Update `CORS_ORIGIN` in `.env` to match however you
  end up serving `site/`.
- Student/startup collaboration data (`SEED_STUDENT_PROJECTS`,
  `SEED_STARTUP_COLLABS` in `mock-data.js`) isn't in the database yet —
  say the word and I'll add those models + routes the same way.
