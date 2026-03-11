# AI Resume Tailor + Job Tracker (Vercel-only)

Production-ready Next.js (App Router + TypeScript) app for:

- Parsing and logging JD details to Google Sheets
- Generating a tailored resume DOCX from a base template while preserving formatting
- Previewing tailored resume content in-browser before printing PDF
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

### Security Notes

- Never commit `.env.local` to Git.
- Never commit raw service account JSON or private keys.
- Keep `ANTHROPIC_API_KEY` and `GOOGLE_SERVICE_ACCOUNT_JSON` only in local env or Vercel env settings.
- Rotate keys immediately if they are exposed.

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

## Resume Output Flow

- Click `Tailor Resume` to generate resume content and DOCX payload.
- Use `Download Resume DOCX` to save the Word file.
- Use `Preview and Print PDF` to open a clean preview tab, then print/save PDF from the browser.

Notes:

- DOCX generation preserves template style by replacing text inside existing Word runs/paragraphs.
- The preview page uses fixed 15pt bullet alignment for clean PDF output.

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

### Example Success Response (`POST /api/tailor-resume`)

```json
{
  "parsed": {
    "title": "Senior Data Engineer",
    "fit_score": 42
  },
  "tailored": {
    "summary_points": ["..."],
    "experience_points": ["..."],
    "skills_line": "...",
    "contract_alignment_note": "...",
    "tailored_fit_score": 67
  },
  "output_path": "generated/1730000000000-resume.docx",
  "docx_base64": "<base64>",
  "file_name": "Lahari_Karrotu_(Senior Data Engineer).docx",
  "sheet_status": "Tailored record logged to Google Sheets."
}
```

### Example Error Response

```json
{
  "detail": "Missing base resume template. Set BASE_RESUME_DOCX_BASE64 in Vercel."
}
```

## Fit Score Behavior

- `fit_score` is the JD-only baseline score from parsing.
- `tailored_fit_score` is computed after tailoring using required-term coverage from the generated resume content (including extracted DOCX text), not a fixed high floor.
- This means tailored scores can go up or down based on actual alignment quality.

## Troubleshooting

- `Missing base resume template`:
  - Set `BASE_RESUME_DOCX_BASE64` in Vercel with a valid single-line DOCX base64 string.
- `Can't find end of central directory`:
  - Your DOCX base64 is corrupted or incomplete; re-encode and re-paste the value.
- Google Sheets permission error (`The caller does not have permission`):
  - Share the sheet with your service account email as Editor.
- Parse/tailor works locally but not on Vercel:
  - Verify all Vercel env vars are set in the correct environment (Production/Preview/Development).
- UI seems to call old backend:
  - Keep `NEXT_PUBLIC_API_BASE_URL` empty for same-origin, then redeploy and hard refresh.

## Known Limitations

- DOCX formatting is preserved by text replacement in existing template runs, but page count can still change if generated text is longer.
- Browser PDF preview is HTML-based and may differ slightly from Microsoft Word PDF export.
- The app optimizes for practical JD-term alignment and does not guarantee perfect semantic matching for every job description.
