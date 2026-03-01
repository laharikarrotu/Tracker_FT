import { NextRequest, NextResponse } from "next/server";
import { appendToGoogleSheet, applyOverrides, enforceContractMode, parseJobDescription } from "@/lib/server-utils";

type Body = {
  job_description: string;
  override_title?: string;
  override_company?: string;
  override_location?: string;
  override_contract?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.job_description?.trim()) {
      return NextResponse.json({ detail: "job_description is required." }, { status: 400 });
    }

    const parsed = applyOverrides(parseJobDescription(body.job_description), body);
    enforceContractMode(parsed);
    await appendToGoogleSheet({ parsed, status: "Not Applied Yet" });

    return NextResponse.json({
      parsed: {
        title: parsed.title,
        company_or_vendor: parsed.company_or_vendor,
        location: parsed.location,
        contract_type: parsed.contract_type,
        skills: parsed.skills,
        fit_score: parsed.fit_score,
        is_contract_like: parsed.is_contract_like
      },
      sheet_status: "JD logged to Google Sheets."
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
