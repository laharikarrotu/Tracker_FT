import { NextRequest, NextResponse } from "next/server";
import {
  appendToGoogleSheet,
  applyOverrides,
  createEmptyParsedJD,
  enrichParsedJDWithClaude,
  generateCallIntro
} from "@/lib/server-utils";

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
    const baseParsed = createEmptyParsedJD(body.job_description);
    const extracted = await enrichParsedJDWithClaude(body.job_description, baseParsed);
    const parsed = applyOverrides(extracted, body);
    const call_intro = await generateCallIntro(parsed);
    let sheet_status = "Call intro logged to Google Sheets.";
    try {
      await appendToGoogleSheet({
        parsed,
        status: "Call Intro Ready",
        callIntro: call_intro
      });
    } catch (sheetError) {
      const message = sheetError instanceof Error ? sheetError.message : "Unknown Sheets error";
      sheet_status = `Call intro generated, but Google Sheets logging failed: ${message}`;
    }
    return NextResponse.json({ call_intro, sheet_status });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}

