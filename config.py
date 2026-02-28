from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    google_service_account_json: Path
    google_sheet_id: str
    google_sheet_tab: str
    base_resume_path: Path
    strict_contract_mode: bool


def _to_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def load_settings() -> Settings:
    load_dotenv()

    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    google_service_account_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    google_sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    google_sheet_tab = os.getenv("GOOGLE_SHEET_TAB", "Applications").strip()
    base_resume_path = os.getenv("BASE_RESUME_PATH", "").strip()
    strict_contract_mode = _to_bool(os.getenv("STRICT_CONTRACT_MODE"), default=True)

    missing = []
    if not anthropic_api_key:
        missing.append("ANTHROPIC_API_KEY")
    if not google_service_account_json:
        missing.append("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not google_sheet_id:
        missing.append("GOOGLE_SHEET_ID")
    if not base_resume_path:
        missing.append("BASE_RESUME_PATH")

    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    return Settings(
        anthropic_api_key=anthropic_api_key,
        google_service_account_json=Path(google_service_account_json),
        google_sheet_id=google_sheet_id,
        google_sheet_tab=google_sheet_tab,
        base_resume_path=Path(base_resume_path),
        strict_contract_mode=strict_contract_mode,
    )
