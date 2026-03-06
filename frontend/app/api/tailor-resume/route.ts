import { NextRequest, NextResponse } from "next/server";
import { parseAndEnrichJD, parseRequestBody, parsedSummary, handleRouteError } from "@/lib/api";
import { appConfig } from "@/lib/config";
import { getTemplateBulletCounts, generateTailoredDocxFromTemplate } from "@/lib/docx";
import { computeTailoredFitScore, generateTailoredContent } from "@/lib/generation";
import { appendToGoogleSheet } from "@/lib/sheets";
import { AppError } from "@/lib/common";

function safeRoleForFileName(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return "Role";
  return trimmed.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ");
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const serverTemplate = appConfig.baseResumeDocxBase64;
    const templateDocxBase64 = (body.template_docx_base64 || serverTemplate).trim();
    if (!templateDocxBase64) {
      throw new AppError("Missing base resume template. Set BASE_RESUME_DOCX_BASE64 in Vercel.", 400);
    }
    const parsed = await parseAndEnrichJD(body);

    const counts = await getTemplateBulletCounts(templateDocxBase64);
    const summaryCount = counts.summaryCount;
    const experienceCount = counts.experienceCount;

    const tailored = await generateTailoredContent(
      parsed,
      summaryCount,
      experienceCount,
      body.anthropic_api_key
    );
    const summary_points = tailored.summary_points.map((x) => x.trim().replace(/\s+/g, " "));
    const experience_points = tailored.experience_points.map((x) => x.trim().replace(/\s+/g, " "));
    const tailored_fit_score = computeTailoredFitScore(parsed, tailored);

    const replacementCaps = {
      maxSummaryReplacements: summaryCount,
      maxExperienceReplacements: experienceCount
    };

    const docx_base64 = await generateTailoredDocxFromTemplate(
      templateDocxBase64,
      {
        ...tailored,
        summary_points,
        experience_points
      },
      replacementCaps
    );

    const output_path = `generated/${Date.now()}-${(body.template_file_name || "tailored").replace(/\s+/g, "_")}`;
    let sheet_status = "Tailored record logged to Google Sheets.";
    try {
      const sheetResult = await appendToGoogleSheet({
        parsed,
        status: "Applied",
        outputPath: output_path,
        notes: tailored.contract_alignment_note,
        tailoredFitScore: tailored_fit_score,
        config: {
          googleSheetId: body.google_sheet_id,
          googleSheetTab: body.google_sheet_tab,
          googleServiceAccountJson: body.google_service_account_json,
        },
      });
      if (sheetResult.duplicateLikely) {
        sheet_status = "Resume generated. Existing duplicate row was updated in Google Sheets.";
      }
    } catch (sheetError) {
      const message = sheetError instanceof Error ? sheetError.message : "Unknown Sheets error";
      sheet_status = `Resume generated, but Google Sheets logging failed: ${message}`;
    }

    return NextResponse.json({
      parsed: parsedSummary(parsed),
      tailored: {
        summary_points,
        experience_points,
        skills_line: tailored.skills_line,
        contract_alignment_note: tailored.contract_alignment_note,
        tailored_fit_score,
      },
      output_path,
      docx_base64,
      file_name: `Lahari_Karrotu_(${safeRoleForFileName(parsed.title)}).docx`,
      sheet_status,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
