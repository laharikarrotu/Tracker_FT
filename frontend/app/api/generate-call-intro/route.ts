import { NextRequest, NextResponse } from "next/server";
import { parseAndEnrichJD, parseRequestBody, handleRouteError } from "@/lib/api";
import { appendToGoogleSheet } from "@/lib/sheets";
import { generateCallIntro } from "@/lib/generation";

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const parsed = await parseAndEnrichJD(body);
    const call_intro = await generateCallIntro(parsed, body.anthropic_api_key);
    let sheet_status = "Call intro logged to Google Sheets.";
    try {
      await appendToGoogleSheet({
        parsed,
        status: "Call Intro Ready",
        callIntro: call_intro,
        config: {
          googleSheetId: body.google_sheet_id,
          googleSheetTab: body.google_sheet_tab,
          googleServiceAccountJson: body.google_service_account_json,
        },
      });
    } catch (sheetError) {
      const message = sheetError instanceof Error ? sheetError.message : "Unknown Sheets error";
      sheet_status = `Call intro generated, but Google Sheets logging failed: ${message}`;
    }
    return NextResponse.json({ call_intro, sheet_status });
  } catch (error) {
    return handleRouteError(error);
  }
}

