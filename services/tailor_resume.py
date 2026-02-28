from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from anthropic import Anthropic


CONTRACT_TERMS = {
    "contract",
    "c2c",
    "corp-to-corp",
    "w2",
    "1099",
    "contractor",
    "vendor",
}

DATA_ENGINEER_SKILLS = {
    "python",
    "pyspark",
    "spark",
    "sql",
    "snowflake",
    "airflow",
    "dbt",
    "databricks",
    "aws",
    "azure",
    "gcp",
    "etl",
    "data pipeline",
    "kafka",
    "redshift",
    "bigquery",
}


@dataclass
class ParsedJobDescription:
    raw_jd: str
    title: str = ""
    company_or_vendor: str = ""
    location: str = ""
    contract_type: str = ""
    skills: list[str] = field(default_factory=list)
    notes: str = ""
    is_contract_like: bool = False
    fit_score: int = 0


@dataclass
class TailoredResumeContent:
    summary_points: list[str]
    experience_points: list[str]
    skills_line: str
    tailored_for_role: str
    contract_alignment_note: str


def _extract_first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _extract_skills(jd: str) -> list[str]:
    jd_lower = jd.lower()
    found = [skill for skill in DATA_ENGINEER_SKILLS if skill in jd_lower]
    return sorted(found)


def parse_job_description(jd: str) -> ParsedJobDescription:
    lines = [line.strip() for line in jd.splitlines() if line.strip()]
    title = ""
    if lines:
        title = lines[0][:120]
    title = _extract_first_match(r"(?:title|position|role)\s*[:\-]\s*([^\n\r]+)", jd) or title
    company_or_vendor = _extract_first_match(
        r"(?:company|client|vendor)\s*[:\-]\s*([^\n\r]+)", jd
    )
    location = _extract_first_match(r"(?:location)\s*[:\-]\s*([^\n\r]+)", jd)
    contract_type = _extract_first_match(
        r"(?:employment type|contract type|type)\s*[:\-]\s*([^\n\r]+)", jd
    )
    skills = _extract_skills(jd)

    jd_lower = jd.lower()
    is_contract_like = any(term in jd_lower for term in CONTRACT_TERMS)
    fit_score = 0
    if "data engineer" in jd_lower or "data engineering" in jd_lower:
        fit_score += 40
    fit_score += min(len(skills) * 6, 36)
    if is_contract_like:
        fit_score += 24
    fit_score = min(fit_score, 100)

    notes = "Contract-focused fit" if is_contract_like else "Needs manual contract check"

    return ParsedJobDescription(
        raw_jd=jd,
        title=title,
        company_or_vendor=company_or_vendor,
        location=location,
        contract_type=contract_type,
        skills=skills,
        notes=notes,
        is_contract_like=is_contract_like,
        fit_score=fit_score,
    )


def _extract_json_from_response(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model did not return valid JSON")
    return json.loads(text[start : end + 1])


def generate_tailored_content(
    *,
    anthropic_api_key: str,
    base_resume_text: str,
    parsed_jd: ParsedJobDescription,
    summary_count: int,
    experience_bullet_count: int,
) -> TailoredResumeContent:
    client = Anthropic(api_key=anthropic_api_key)

    prompt = f"""
You are an expert C2C consulting resume writer for Data Engineer roles.

Task:
1) Tailor resume content to the job description.
2) Keep output professional, concise, and contract-friendly.
3) Maintain exact structure constraints:
   - summary_points count: {summary_count}
   - experience_points count: {experience_bullet_count}
4) Return ONLY JSON with this schema:
{{
  "summary_points": ["...", "..."],
  "experience_points": ["...", "..."],
  "skills_line": "...",
  "tailored_for_role": "...",
  "contract_alignment_note": "..."
}}

Job description:
{parsed_jd.raw_jd}

Parsed fields:
- title: {parsed_jd.title}
- company_or_vendor: {parsed_jd.company_or_vendor}
- location: {parsed_jd.location}
- contract_type: {parsed_jd.contract_type}
- extracted_skills: {", ".join(parsed_jd.skills)}
- fit_score: {parsed_jd.fit_score}

Base resume text:
{base_resume_text}
"""

    response = client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=1800,
        temperature=0.3,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = ""
    for block in response.content:
        if getattr(block, "type", "") == "text":
            response_text += block.text

    data = _extract_json_from_response(response_text)
    summary_points = [str(item).strip() for item in data.get("summary_points", []) if str(item).strip()]
    experience_points = [
        str(item).strip() for item in data.get("experience_points", []) if str(item).strip()
    ]
    skills_line = str(data.get("skills_line", "")).strip()
    tailored_for_role = str(data.get("tailored_for_role", parsed_jd.title or "Data Engineer")).strip()
    contract_alignment_note = str(data.get("contract_alignment_note", parsed_jd.notes)).strip()

    if len(summary_points) != summary_count:
        summary_points = (summary_points + [""] * summary_count)[:summary_count]
    if len(experience_points) != experience_bullet_count:
        experience_points = (experience_points + [""] * experience_bullet_count)[:experience_bullet_count]

    return TailoredResumeContent(
        summary_points=summary_points,
        experience_points=experience_points,
        skills_line=skills_line,
        tailored_for_role=tailored_for_role,
        contract_alignment_note=contract_alignment_note,
    )


def generate_submission_email_template(
    *,
    anthropic_api_key: str,
    parsed_jd: ParsedJobDescription,
    tailored: TailoredResumeContent,
    candidate_name: str = "Mehar Lahari",
) -> str:
    client = Anthropic(api_key=anthropic_api_key)

    prompt = f"""
Write a concise, professional C2C consulting submission email for a Data Engineer role.

Requirements:
- Return plain text only.
- Keep it under 180 words.
- Include:
  1) Subject line starting with "Subject:"
  2) Short greeting
  3) 3-5 lines highlighting strongest JD match points
  4) Availability and contract-friendly note
  5) Closing with candidate name
- Tone: confident, polite, recruiter/vendor-friendly.
- Do not invent certifications or years not present in provided context.

Candidate:
- Name: {candidate_name}
- Tailored role: {tailored.tailored_for_role}
- Skills line: {tailored.skills_line}
- Contract note: {tailored.contract_alignment_note}

Job fields:
- Title: {parsed_jd.title}
- Company/Vendor: {parsed_jd.company_or_vendor}
- Location: {parsed_jd.location}
- Contract type: {parsed_jd.contract_type}
- Extracted skills: {", ".join(parsed_jd.skills)}
"""

    response = client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=450,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = ""
    for block in response.content:
        if getattr(block, "type", "") == "text":
            response_text += block.text

    return response_text.strip()
