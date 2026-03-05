import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/common";
import { applyOverrides, enrichParsedJDWithClaude, parseJobDescription } from "@/lib/jd";
import type { JDRequestBody, ParsedJD } from "@/lib/types";

export async function parseRequestBody(req: NextRequest): Promise<JDRequestBody> {
  const body = (await req.json()) as JDRequestBody;
  if (!body.job_description?.trim()) {
    throw new AppError("job_description is required.", 400);
  }
  return body;
}

export async function parseAndEnrichJD(body: JDRequestBody): Promise<ParsedJD> {
  const baseline = parseJobDescription(body.job_description);
  const enriched = await enrichParsedJDWithClaude(
    body.job_description,
    baseline,
    body.anthropic_api_key
  );
  return applyOverrides(enriched, body);
}

export function parsedSummary(parsed: ParsedJD) {
  return {
    title: parsed.title,
    company_or_vendor: parsed.company_or_vendor,
    recruiter_name: parsed.recruiter_name,
    vendor_email: parsed.vendor_email,
    vendor_phone: parsed.vendor_phone,
    location: parsed.location,
    remote_mode: parsed.remote_mode,
    contract_type: parsed.contract_type,
    pay_rate: parsed.pay_rate,
    job_id_url: parsed.job_id_url,
    skills: parsed.skills,
    role_track: parsed.role_track,
    required_terms: parsed.required_terms,
    fit_score: parsed.fit_score,
    is_contract_like: parsed.is_contract_like,
  };
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json({ detail: message }, { status: 500 });
}
