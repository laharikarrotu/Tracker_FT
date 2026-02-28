from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import load_settings
from services.docx_writer import analyze_template_constraints, read_resume_text, write_tailored_resume
from services.sheets_writer import append_application_row
from services.tailor_resume import (
    ParsedJobDescription,
    TailoredResumeContent,
    generate_submission_email_template,
    generate_tailored_content,
    parse_job_description,
)


app = FastAPI(title="Resume Tailor API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JDRequest(BaseModel):
    job_description: str = Field(min_length=10)
    override_title: str = ""
    override_company: str = ""
    override_location: str = ""
    override_contract: str = ""


class TailorRequest(JDRequest):
    replacement_mode: str = "minimal"


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-")
    return cleaned.lower()[:60] or "data-engineer-role"


def _length_guard(points: list[str], max_chars: int) -> list[str]:
    guarded = []
    for point in points:
        normalized = " ".join(point.split())
        guarded.append(normalized if len(normalized) <= max_chars else normalized[: max_chars - 3] + "...")
    return guarded


def _apply_overrides(payload: JDRequest) -> ParsedJobDescription:
    parsed = parse_job_description(payload.job_description)
    if payload.override_title.strip():
        parsed.title = payload.override_title.strip()
    if payload.override_company.strip():
        parsed.company_or_vendor = payload.override_company.strip()
    if payload.override_location.strip():
        parsed.location = payload.override_location.strip()
    if payload.override_contract.strip():
        parsed.contract_type = payload.override_contract.strip()
    return parsed


def _check_contract_mode(parsed: ParsedJobDescription) -> None:
    settings = load_settings()
    if settings.strict_contract_mode and not parsed.is_contract_like:
        raise HTTPException(status_code=400, detail="JD is not contract/C2C-like while strict mode is enabled.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/parse-and-log")
def parse_and_log(payload: JDRequest):
    try:
        settings = load_settings()
        parsed = _apply_overrides(payload)
        _check_contract_mode(parsed)

        write_result = append_application_row(
            service_account_json=settings.google_service_account_json,
            sheet_id=settings.google_sheet_id,
            sheet_tab=settings.google_sheet_tab,
            parsed_jd=parsed,
            application_status="Not Applied Yet",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "parsed": {
            "title": parsed.title,
            "company_or_vendor": parsed.company_or_vendor,
            "location": parsed.location,
            "contract_type": parsed.contract_type,
            "skills": parsed.skills,
            "fit_score": parsed.fit_score,
            "is_contract_like": parsed.is_contract_like,
        },
        "sheet_status": f"Logged to `{write_result.worksheet_title}` row {write_result.row_index}.",
    }


@app.post("/api/tailor-resume")
def tailor_resume(payload: TailorRequest):
    try:
        settings = load_settings()
        parsed = _apply_overrides(payload)
        _check_contract_mode(parsed)

        constraints = analyze_template_constraints(settings.base_resume_path)
        resume_text = read_resume_text(settings.base_resume_path)
        tailored = generate_tailored_content(
            anthropic_api_key=settings.anthropic_api_key,
            base_resume_text=resume_text,
            parsed_jd=parsed,
            summary_count=constraints.summary_count,
            experience_bullet_count=constraints.experience_bullet_count,
        )
        tailored.summary_points = _length_guard(tailored.summary_points, 125)
        tailored.experience_points = _length_guard(tailored.experience_points, 165)

        summary_replacements = None
        exp_replacements = None
        mode = payload.replacement_mode.lower().strip()
        if mode == "minimal":
            summary_replacements, exp_replacements = 1, 2
        elif mode == "balanced":
            summary_replacements, exp_replacements = 2, 6

        role_slug = _slugify(parsed.title or "data-engineer")
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = Path("outputs") / f"{timestamp}-{role_slug}-tailored.docx"
        write_tailored_resume(
            base_resume_path=settings.base_resume_path,
            output_path=output_path,
            tailored_content=tailored,
            max_summary_replacements=summary_replacements,
            max_experience_replacements=exp_replacements,
        )
        write_result = append_application_row(
            service_account_json=settings.google_service_account_json,
            sheet_id=settings.google_sheet_id,
            sheet_tab=settings.google_sheet_tab,
            parsed_jd=parsed,
            tailored=tailored,
            output_file=output_path.resolve(),
            application_status="Applied",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "parsed": {
            "title": parsed.title,
            "company_or_vendor": parsed.company_or_vendor,
            "location": parsed.location,
            "contract_type": parsed.contract_type,
            "skills": parsed.skills,
            "fit_score": parsed.fit_score,
            "is_contract_like": parsed.is_contract_like,
        },
        "tailored": {
            "summary_points": tailored.summary_points,
            "experience_points": tailored.experience_points,
            "skills_line": tailored.skills_line,
            "contract_alignment_note": tailored.contract_alignment_note,
        },
        "output_path": str(output_path.resolve()),
        "sheet_status": f"Logged to `{write_result.worksheet_title}` row {write_result.row_index}.",
    }


@app.post("/api/generate-email")
def generate_email(payload: JDRequest):
    try:
        settings = load_settings()
        parsed = _apply_overrides(payload)
        _check_contract_mode(parsed)
        fallback_tailored = TailoredResumeContent(
            summary_points=[],
            experience_points=[],
            skills_line=", ".join(parsed.skills),
            tailored_for_role=parsed.title or "Data Engineer",
            contract_alignment_note=parsed.notes,
        )
        email_template = generate_submission_email_template(
            anthropic_api_key=settings.anthropic_api_key,
            parsed_jd=parsed,
            tailored=fallback_tailored,
            candidate_name="Mehar Lahari",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"email_template": email_template}
