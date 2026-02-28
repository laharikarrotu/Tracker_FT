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

## Run locally

```bash
# in repo root
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# in another terminal
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Deploy to Vercel

- Push this project to GitHub
- Import repo into Vercel
- Set root directory to `frontend`
- Set env var `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL
- Deploy

## Backend connection note

This frontend already calls backend API endpoints:

- `POST /api/parse-and-log`
- `POST /api/tailor-resume`
- `POST /api/generate-email`
