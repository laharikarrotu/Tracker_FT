import { NextRequest, NextResponse } from "next/server";
import { applyOverrides, generateSubmissionEmail, parseJobDescription } from "@/lib/server-utils";

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
    const email_template = await generateSubmissionEmail(parsed);
    return NextResponse.json({ email_template });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
