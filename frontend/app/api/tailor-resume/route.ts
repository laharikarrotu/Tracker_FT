import { NextRequest, NextResponse } from "next/server";
import {
  appendToGoogleSheet,
  applyOverrides,
  createEmptyParsedJD,
  enrichParsedJDWithClaude,
  getTemplateBulletCounts,
  generateTailoredDocxFromTemplate,
  generateTailoredContent,
} from "@/lib/server-utils";

type Body = {
  job_description: string;
  override_title?: string;
  override_company?: string;
  override_location?: string;
  override_contract?: string;
  template_docx_base64?: string;
  template_file_name?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.job_description?.trim()) {
      return NextResponse.json({ detail: "job_description is required." }, { status: 400 });
    }
    const serverTemplate = (process.env.BASE_RESUME_DOCX_BASE64 || "").trim();
    const templateDocxBase64 = (body.template_docx_base64 || serverTemplate).trim();
    if (!templateDocxBase64) {
      return NextResponse.json(
        { detail: "Missing base resume template. Set BASE_RESUME_DOCX_BASE64 in Vercel." },
        { status: 400 }
      );
    }

    const baseParsed = createEmptyParsedJD(body.job_description);
    const extracted = await enrichParsedJDWithClaude(body.job_description, baseParsed);
    const parsed = applyOverrides(extracted, body);

    // Enforce exact bullet counts from the uploaded/base template.
    const counts = await getTemplateBulletCounts(templateDocxBase64);
    const summaryCount = counts.summaryCount;
    const experienceCount = counts.experienceCount;

    const tailored = await generateTailoredContent(parsed, summaryCount, experienceCount);
    const summary_points = tailored.summary_points.map((x) => x.trim().replace(/\s+/g, " "));
    const experience_points = tailored.experience_points.map((x) => x.trim().replace(/\s+/g, " "));

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
        recruiter_name: parsed.recruiter_name,
        vendor_email: parsed.vendor_email,
        location: parsed.location,
        contract_type: parsed.contract_type,
        remote_mode: parsed.remote_mode,
        pay_rate: parsed.pay_rate,
        job_id_url: parsed.job_id_url,
        skills: parsed.skills,
        role_track: parsed.role_track,
        required_terms: parsed.required_terms,
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
      docx_base64,
      file_name: `tailored-${(body.template_file_name || "resume").replace(/\s+/g, "_")}`,
      sheet_status: "Tailored record logged to Google Sheets."
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
