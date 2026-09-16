# Implementation Plan — Grievance → AI Enrichment → Student Section → Solution Submission

## Overview
Make every citizen grievance submitted via `POST /api/problems` automatically categorized, de-duplicated, priority-scored, and rewritten into a student-ready problem statement by a server-side xAI Grok API, then surfaced live from MongoDB in the student section where students can read it and submit solutions.

## Types
See `server/src/models/Problem.js` (+ enrichedDescription, problemStatement, categoryConfidence, priorityLabel, priorityReasons, similarity, mergedIds, visibleToStudents, aiMeta) and `server/src/models/Solution.js` (id, problemId, studentId, title, summary, approach, techStack, timelineDays, team, status).

## Files
- New: `server/src/models/Solution.js`, `server/src/services/aiAnalyzer.js`, `server/src/routes/solutions.js`, `implementation_plan.md`
- Modified: `server/src/models/Problem.js`, `server/src/utils/categorize.js`, `server/src/routes/problems.js`, `server/src/app.js`, `server/src/server.js`, `server/package.json` (check script), `server/.env.example`, `server/README.md`, `site/js/api.js`, `site/student/dashboard.html`, `site/student/problem-view.html`, `site/student/proposal-submission.html`

## Functions
- `analyzeWithAi`, `buildAnalysisPrompt`, `fallbackAnalysis` in `aiAnalyzer.js`
- `POST /api/problems` (AI + dedup merge), `GET /api/problems?audience=student`, `GET /api/problems/:id?audience=student`, `POST /api/problems/:id/reanalyze`
- `POST /api/solutions`, `GET /api/solutions?problemId=`, `GET /api/solutions/:id`
- Frontend: `getStudentProblems`, `getStudentProblemById`, `submitSolution`, `getSolutionsForProblem`

## Classes
- `Problem` extended; `Solution` new Mongoose model.

## Dependencies
- No new npm packages (Node 20 global fetch). Env: `AI_PROVIDER=xai`, `AI_API_URL=https://api.x.ai/v1/chat/completions`, `AI_MODEL=grok-3-mini`, `AI_API_KEY` (server `.env` only), `AI_TIMEOUT_MS=15000`.

## Testing
- `npm run check`; curl suite for problems/student/solutions; Live Server UI pass; no-key fallback pass.

## Implementation Order
1. Problem/Solution models 2. categorize seam 3. aiAnalyzer 4. problems routes 5. solutions routes + mount 6. env/docs 7. api.js 8. dashboard 9. problem-view + proposal 10. validate
