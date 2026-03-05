# AI Resume Tailor + Job Tracker (Vercel-only)

Production-ready Next.js (App Router + TypeScript) app for:

- Parsing and logging JD details to Google Sheets
- Generating a tailored resume DOCX from a base template while preserving formatting
- Generating a submission email
- Generating a one-page cover letter
- Generating a 4-5 line recruiter-call self-intro

No separate backend service is required. All server logic is in Next.js API routes.

## Tech Stack

- Next.js 14+ App Router
- TypeScript
- `@anthropic-ai/sdk` (Claude)
- `googleapis` (Google Sheets)
- `jszip` (DOCX XML updates)

## Personalization Config

Update candidate profile values in `lib/profile.ts`:

- name
- title
- email
- phone
- defaultRoleFamily

The email signature and call intro generation use these values.

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required and optional keys:

- `ANTHROPIC_API_KEY` (required)
- `ANTHROPIC_TAILOR_MODEL` (optional)
- `ANTHROPIC_EMAIL_MODEL` (optional)
- `ANTHROPIC_EXTRACTION_MODEL` (optional)
- `CLAUDE_EXTRACTION_ENABLED` (`true|false`, default `true`)
- `CLAUDE_EXTRACTION_ONLY` (`true|false`, default `true`)
- `GOOGLE_SERVICE_ACCOUNT_JSON` (required, raw JSON or base64 JSON)
- `GOOGLE_SHEET_ID` (required)
- `GOOGLE_SHEET_TAB` (optional, default `Applications`)
- `BASE_RESUME_DOCX_BASE64` (required for resume generation)
- `NEXT_PUBLIC_API_BASE_URL` (optional, leave empty for same-origin)

## Local Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Build Verification

```bash
npm run build
```

## Vercel Deploy

1. Push repo to GitHub.
2. Import project in Vercel.
3. Set project root to `frontend`.
4. Configure all env vars from `.env.example`.
5. Deploy.

## API Routes

- `POST /api/parse-and-log`
- `POST /api/tailor-resume`
- `POST /api/generate-email`
- `POST /api/generate-cover-letter`
- `POST /api/generate-call-intro`

Request body schema for all routes:

```json
{
  "job_description": "string",
  "anthropic_api_key": "string (optional per-user Claude key override)",
  "override_title": "string (optional)",
  "override_company": "string (optional)",
  "override_location": "string (optional)",
  "override_contract": "string (optional)",
  "template_docx_base64": "string (optional, tailor route)",
  "template_file_name": "string (optional, tailor route)",
  "google_sheet_id": "string (optional, parse/tailor/call-intro routes)",
  "google_sheet_tab": "string (optional, parse/tailor/call-intro routes)",
  "google_service_account_json": "string (optional raw/base64 JSON, parse/tailor/call-intro routes)"
}
```

You can now override the base resume template and Sheets config per request. If omitted, server env vars are used.

Google Sheets logging is full-time-first and maps common headers such as company, recruiter/hiring manager, job URL, employment type, compensation/salary, stage/status, and interview outcome. Legacy vendor/C2C header names remain supported for compatibility.
