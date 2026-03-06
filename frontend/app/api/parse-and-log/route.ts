import { NextRequest, NextResponse } from "next/server";
import { parseAndEnrichJD, parseRequestBody, parsedSummary, handleRouteError } from "@/lib/api";
import { appendToGoogleSheet } from "@/lib/sheets";

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const parsed = await parseAndEnrichJD(body);
    let sheetStatus = "JD logged to Google Sheets.";
    try {
      const sheetResult = await appendToGoogleSheet({
        parsed,
        status: "Not Applied Yet",
        config: {
          googleSheetId: body.google_sheet_id,
          googleSheetTab: body.google_sheet_tab,
          googleServiceAccountJson: body.google_service_account_json,
        },
      });
      if (sheetResult.duplicateLikely) {
        sheetStatus = "This JD looks duplicate (same JD + company + title). Existing row was updated.";
      }
    } catch (sheetError) {
      const message = sheetError instanceof Error ? sheetError.message : "Unknown Sheets error";
      sheetStatus = `JD parsed, but Google Sheets logging failed: ${message}`;
    }

    return NextResponse.json({
      parsed: parsedSummary(parsed),
      sheet_status: sheetStatus,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
