import { NextRequest, NextResponse } from "next/server";
import {
  appendToGoogleSheet,
  applyOverrides,
  enforceContractMode,
  generateTailoredContent,
  parseJobDescription
} from "@/lib/server-utils";

type Body = {
  job_description: string;
  override_title?: string;
  override_company?: string;
  override_location?: string;
  override_contract?: string;
  replacement_mode?: "minimal" | "balanced" | "aggressive";
};

function clampLine(value: string, maxChars: number) {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trim()}...`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.job_description?.trim()) {
      return NextResponse.json({ detail: "job_description is required." }, { status: 400 });
    }

    const parsed = applyOverrides(parseJobDescription(body.job_description), body);
    enforceContractMode(parsed);

    const replacement_mode = body.replacement_mode || "minimal";
    const summaryCount = replacement_mode === "aggressive" ? 4 : replacement_mode === "balanced" ? 2 : 1;
    const experienceCount = replacement_mode === "aggressive" ? 10 : replacement_mode === "balanced" ? 6 : 2;

    const tailored = await generateTailoredContent(parsed, summaryCount, experienceCount);
    const summary_points = tailored.summary_points.map((x) => clampLine(x, 125));
    const experience_points = tailored.experience_points.map((x) => clampLine(x, 165));

    const output_path = "Generated on Vercel API (DOCX export endpoint can be added next).";
    await appendToGoogleSheet({
      parsed,
      status: "Applied",
      outputPath: output_path,
      notes: tailored.contract_alignment_note
    });

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
      tailored: {
        summary_points,
        experience_points,
        skills_line: tailored.skills_line,
        contract_alignment_note: tailored.contract_alignment_note
      },
      output_path,
      sheet_status: "Tailored record logged to Google Sheets."
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
