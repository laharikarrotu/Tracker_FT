from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from services.tailor_resume import ParsedJobDescription, TailoredResumeContent


SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


@dataclass
class SheetWriteResult:
    worksheet_title: str
    row_index: int


def _normalize_header(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum())


def _build_value_map(
    parsed_jd: ParsedJobDescription,
    tailored: TailoredResumeContent | None,
    output_file: Path | None,
    application_status: str,
) -> dict[str, str]:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    contract_note = tailored.contract_alignment_note if tailored else parsed_jd.notes
    tailored_role = tailored.tailored_for_role if tailored else parsed_jd.title
    output_path = str(output_file) if output_file else ""
    return {
        "timestamp": now,
        "date": now.split()[0],
        "jobtitle": parsed_jd.title,
        "title": parsed_jd.title,
        "company": parsed_jd.company_or_vendor,
        "vendor": parsed_jd.company_or_vendor,
        "client": parsed_jd.company_or_vendor,
        "location": parsed_jd.location,
        "contracttype": parsed_jd.contract_type or ("C2C/Contract" if parsed_jd.is_contract_like else ""),
        "employmenttype": parsed_jd.contract_type,
        "skills": ", ".join(parsed_jd.skills),
        "matchscore": str(parsed_jd.fit_score),
        "fitscore": str(parsed_jd.fit_score),
        "label": application_status,
        "status": application_status,
        "notes": contract_note,
        "tailoredresume": output_path,
        "resumeoutputpath": output_path,
        "tailoredforrole": tailored_role,
    }


def _open_worksheet(client: gspread.Client, sheet_id: str, preferred_tab: str):
    workbook = client.open_by_key(sheet_id)
    try:
        return workbook.worksheet(preferred_tab)
    except gspread.WorksheetNotFound:
        return workbook.sheet1


def append_application_row(
    *,
    service_account_json: Path,
    sheet_id: str,
    sheet_tab: str,
    parsed_jd: ParsedJobDescription,
    tailored: TailoredResumeContent | None = None,
    output_file: Path | None = None,
    application_status: str = "Applied",
    max_retries: int = 3,
) -> SheetWriteResult:
    creds = Credentials.from_service_account_file(str(service_account_json), scopes=SCOPES)
    client = gspread.authorize(creds)

    worksheet = _open_worksheet(client, sheet_id, sheet_tab)
    headers = worksheet.row_values(1)
    normalized_headers = [_normalize_header(h) for h in headers]
    value_map = _build_value_map(parsed_jd, tailored, output_file, application_status)

    row_values = []
    for normalized in normalized_headers:
        row_values.append(value_map.get(normalized, ""))

    if not any(row_values):
        # Fallback for trackers without headers on row 1.
        row_values = [
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            parsed_jd.title,
            parsed_jd.company_or_vendor,
            parsed_jd.location,
            parsed_jd.contract_type or ("C2C/Contract" if parsed_jd.is_contract_like else ""),
            ", ".join(parsed_jd.skills),
            str(parsed_jd.fit_score),
            application_status,
            tailored.contract_alignment_note if tailored else parsed_jd.notes,
            str(output_file) if output_file else "",
        ]

    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            worksheet.append_row(row_values, value_input_option="USER_ENTERED")
            row_index = len(worksheet.col_values(1))
            return SheetWriteResult(worksheet_title=worksheet.title, row_index=row_index)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == max_retries:
                break
            time.sleep(0.8 * attempt)

    assert last_error is not None
    raise last_error
