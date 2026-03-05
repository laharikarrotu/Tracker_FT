import { NextRequest, NextResponse } from "next/server";
import { parseAndEnrichJD, parseRequestBody, handleRouteError } from "@/lib/api";
import { generateSubmissionEmail } from "@/lib/generation";

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const parsed = await parseAndEnrichJD(body);
    const email_template = await generateSubmissionEmail(parsed);
    return NextResponse.json({ email_template });
  } catch (error) {
    return handleRouteError(error);
  }
}
