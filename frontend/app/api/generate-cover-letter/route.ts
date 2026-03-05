import { NextRequest, NextResponse } from "next/server";
import { parseAndEnrichJD, parseRequestBody, handleRouteError } from "@/lib/api";
import { generateCoverLetter } from "@/lib/generation";

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const parsed = await parseAndEnrichJD(body);
    const cover_letter = await generateCoverLetter(parsed);
    return NextResponse.json({ cover_letter });
  } catch (error) {
    return handleRouteError(error);
  }
}

