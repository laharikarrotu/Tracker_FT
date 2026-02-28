from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re

import streamlit as st

from config import load_settings
from services.docx_writer import (
    analyze_template_constraints,
    read_resume_text,
    write_tailored_resume,
)
from services.sheets_writer import append_application_row
from services.tailor_resume import (
    TailoredResumeContent,
    generate_submission_email_template,
    generate_tailored_content,
    parse_job_description,
)


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-")
    return cleaned.lower()[:60] or "data-engineer-role"


def _apply_length_guard(points: list[str], max_chars: int) -> list[str]:
    guarded = []
    for point in points:
        p = " ".join(point.split())
        guarded.append(p if len(p) <= max_chars else p[: max_chars - 3].rstrip() + "...")
    return guarded


def _parse_with_overrides(
    job_description: str,
    override_title: str,
    override_company: str,
    override_location: str,
    override_contract: str,
):
    parsed = parse_job_description(job_description)
    if override_title.strip():
        parsed.title = override_title.strip()
    if override_company.strip():
        parsed.company_or_vendor = override_company.strip()
    if override_location.strip():
        parsed.location = override_location.strip()
    if override_contract.strip():
        parsed.contract_type = override_contract.strip()
    return parsed


def main() -> None:
    st.set_page_config(page_title="Local Resume Tailor", layout="wide")
    st.title("Local Resume Tailor MVP")
    st.caption("Paste a job description, generate a tailored DOCX, and log to Google Sheets.")

    try:
        settings = load_settings()
    except Exception as exc:  # noqa: BLE001
        st.error(f"Configuration error: {exc}")
        st.info("Copy `.env.example` to `.env`, set keys/paths, then restart Streamlit.")
        return

    with st.expander("Runtime Settings", expanded=False):
        st.write(f"Base resume: `{settings.base_resume_path}`")
        st.write(f"Google Sheet ID: `{settings.google_sheet_id}`")
        st.write(f"Target tab: `{settings.google_sheet_tab}`")
        st.write(f"Strict contract mode: `{settings.strict_contract_mode}`")

    job_description = st.text_area("Paste Job Description", height=320)
    col1, col2 = st.columns(2)
    with col1:
        override_title = st.text_input("Override Job Title (optional)")
        override_company = st.text_input("Override Company/Vendor (optional)")
    with col2:
        override_location = st.text_input("Override Location (optional)")
        override_contract = st.text_input("Override Contract Type (optional)")

    replacement_mode = st.selectbox(
        "Resume replacement mode",
        options=[
            "Minimal (1 summary, 2 experience bullets)",
            "Balanced (2 summary, 6 experience bullets)",
            "Aggressive (full section replacement)",
        ],
        index=0,
    )

    if "parsed_jd" not in st.session_state:
        st.session_state.parsed_jd = None
    if "tailored" not in st.session_state:
        st.session_state.tailored = None
    if "output_path" not in st.session_state:
        st.session_state.output_path = ""
    if "sheet_status" not in st.session_state:
        st.session_state.sheet_status = ""
    if "email_template" not in st.session_state:
        st.session_state.email_template = ""

    b1, b2, b3 = st.columns(3)
    parse_clicked = b1.button("Parse & Log JD", use_container_width=True)
    tailor_clicked = b2.button("Tailor Resume", type="primary", use_container_width=True)
    email_clicked = b3.button("Generate Email", use_container_width=True)

    if parse_clicked:
        if not job_description.strip():
            st.warning("Please paste a job description first.")
        else:
            with st.spinner("Parsing JD and logging to Google Sheets..."):
                parsed = _parse_with_overrides(
                    job_description,
                    override_title,
                    override_company,
                    override_location,
                    override_contract,
                )
                if settings.strict_contract_mode and not parsed.is_contract_like:
                    st.error("Strict contract mode is ON and this JD does not look contract/C2C-focused.")
                    st.stop()
                st.session_state.parsed_jd = parsed
                try:
                    write_result = append_application_row(
                        service_account_json=settings.google_service_account_json,
                        sheet_id=settings.google_sheet_id,
                        sheet_tab=settings.google_sheet_tab,
                        parsed_jd=parsed,
                        application_status="Not Applied Yet",
                    )
                    st.session_state.sheet_status = (
                        f"JD logged to `{write_result.worksheet_title}` row {write_result.row_index}."
                    )
                except Exception as exc:  # noqa: BLE001
                    st.session_state.sheet_status = f"JD parsed, but sheet log failed: {exc}"

    if tailor_clicked:
        if not job_description.strip():
            st.warning("Please paste a job description first.")
        else:
            parsed = _parse_with_overrides(
                job_description,
                override_title,
                override_company,
                override_location,
                override_contract,
            )
            st.session_state.parsed_jd = parsed
            if settings.strict_contract_mode and not parsed.is_contract_like:
                st.error("Strict contract mode is ON and this JD does not look contract/C2C-focused.")
                st.stop()
            try:
                constraints = analyze_template_constraints(settings.base_resume_path)
                resume_text = read_resume_text(settings.base_resume_path)
            except Exception as exc:  # noqa: BLE001
                st.error(f"Could not read base resume template: {exc}")
                return

            with st.spinner("Generating tailored content with Claude Sonnet..."):
                try:
                    tailored = generate_tailored_content(
                        anthropic_api_key=settings.anthropic_api_key,
                        base_resume_text=resume_text,
                        parsed_jd=parsed,
                        summary_count=constraints.summary_count,
                        experience_bullet_count=constraints.experience_bullet_count,
                    )
                except Exception as exc:  # noqa: BLE001
                    st.error(f"Tailoring failed: {exc}")
                    return

            # Keep content concise to reduce page drift from your 4-page baseline.
            tailored.summary_points = _apply_length_guard(tailored.summary_points, max_chars=125)
            tailored.experience_points = _apply_length_guard(tailored.experience_points, max_chars=165)

            summary_replacements = None
            experience_replacements = None
            if replacement_mode.startswith("Minimal"):
                summary_replacements, experience_replacements = 1, 2
            elif replacement_mode.startswith("Balanced"):
                summary_replacements, experience_replacements = 2, 6

            role_slug = _slugify(parsed.title or "data-engineer")
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            output_path = Path("outputs") / f"{timestamp}-{role_slug}-tailored.docx"
            with st.spinner("Writing tailored DOCX while preserving template format..."):
                try:
                    write_tailored_resume(
                        base_resume_path=settings.base_resume_path,
                        output_path=output_path,
                        tailored_content=tailored,
                        max_summary_replacements=summary_replacements,
                        max_experience_replacements=experience_replacements,
                    )
                except Exception as exc:  # noqa: BLE001
                    st.error(f"DOCX write failed: {exc}")
                    return

            st.session_state.tailored = tailored
            st.session_state.output_path = str(output_path.resolve())

            try:
                write_result = append_application_row(
                    service_account_json=settings.google_service_account_json,
                    sheet_id=settings.google_sheet_id,
                    sheet_tab=settings.google_sheet_tab,
                    parsed_jd=parsed,
                    tailored=tailored,
                    output_file=output_path.resolve(),
                    application_status="Applied",
                )
                st.session_state.sheet_status = (
                    f"Tailored resume generated and logged to `{write_result.worksheet_title}` row {write_result.row_index}."
                )
            except Exception as exc:  # noqa: BLE001
                st.session_state.sheet_status = f"Resume generated, but sheet update failed: {exc}"

    if email_clicked:
        parsed = st.session_state.parsed_jd
        if parsed is None:
            if not job_description.strip():
                st.warning("Paste a JD first, then click Parse & Log JD or Tailor Resume.")
                st.stop()
            parsed = _parse_with_overrides(
                job_description,
                override_title,
                override_company,
                override_location,
                override_contract,
            )
            st.session_state.parsed_jd = parsed

        tailored = st.session_state.tailored
        if tailored is None:
            tailored = TailoredResumeContent(
                summary_points=[],
                experience_points=[],
                skills_line=", ".join(parsed.skills),
                tailored_for_role=parsed.title or "Data Engineer",
                contract_alignment_note=parsed.notes,
            )
        with st.spinner("Generating submission email template..."):
            try:
                st.session_state.email_template = generate_submission_email_template(
                    anthropic_api_key=settings.anthropic_api_key,
                    parsed_jd=parsed,
                    tailored=tailored,
                    candidate_name="Mehar Lahari",
                )
            except Exception as exc:  # noqa: BLE001
                st.session_state.email_template = f"Email template generation failed: {exc}"

    parsed = st.session_state.parsed_jd
    if parsed is not None:
        st.subheader("Extracted JD Details")
        st.json(
            {
                "title": parsed.title,
                "company_or_vendor": parsed.company_or_vendor,
                "location": parsed.location,
                "contract_type": parsed.contract_type,
                "skills": parsed.skills,
                "fit_score": parsed.fit_score,
                "is_contract_like": parsed.is_contract_like,
            }
        )

    if st.session_state.output_path:
        st.success("Tailored resume is ready.")
        st.write(f"Output file: `{st.session_state.output_path}`")

    if st.session_state.sheet_status:
        st.write(st.session_state.sheet_status)

    tailored = st.session_state.tailored
    if tailored is not None:
        with st.expander("Generated Preview", expanded=True):
            st.markdown("**Summary points**")
            for point in tailored.summary_points:
                st.write(f"- {point}")
            st.markdown("**Experience points**")
            for point in tailored.experience_points[: min(8, len(tailored.experience_points))]:
                st.write(f"- {point}")
            st.markdown(f"**Skills line:** {tailored.skills_line}")
            st.markdown(f"**Contract note:** {tailored.contract_alignment_note}")

    with st.expander("Submission Email Template", expanded=True):
        st.text_area(
            "Copy and send this email",
            value=st.session_state.email_template,
            height=220,
            key="submission_email_template",
        )


if __name__ == "__main__":
    main()
