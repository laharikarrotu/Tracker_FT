# Frontend (Vercel-ready)

This folder contains a Next.js frontend for your resume tailoring workflow.

## What is in it

- Single page app with:
  - Job description paste area
  - Replacement mode selector (minimal, balanced, aggressive)
  - `Parse and Log JD` button
  - `Tailor Resume` button
  - `Generate Email` button
  - Extracted JD preview panel
  - Output panel with status, resume path, and email template

## Run locally (Vercel-only architecture)

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local` (example):

```bash
ANTHROPIC_API_KEY=your_claude_key
GOOGLE_SHEET_ID=1noFNOro2CivUnxUHGqeXDMmQ-6cgQFYa8MdZ4d3YSTw
GOOGLE_SHEET_TAB=Applications
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
STRICT_CONTRACT_MODE=true
# optional; default is same-origin
NEXT_PUBLIC_API_BASE_URL=
```

## Deploy to Vercel

- Push this project to GitHub
- Import repo into Vercel
- Set root directory to `frontend`
- Add env vars from `.env.local` in Vercel project settings
- Deploy

## API routes included in this Next.js app

This app includes server-side Next.js routes (no separate host):

- `POST /api/parse-and-log`
- `POST /api/tailor-resume`
- `POST /api/generate-email`

Current `/api/tailor-resume` returns tailored content + sheet update metadata in Vercel mode. If you want direct DOCX file downloads from this route, add a dedicated export endpoint next.
