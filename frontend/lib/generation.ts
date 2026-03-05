import { callClaudeWithFallback } from "@/lib/anthropic";
import { appConfig } from "@/lib/config";
import { extractJsonObject } from "@/lib/common";
import { CANDIDATE_PROFILE, signatureBlock } from "@/lib/profile";
import type { ParsedJD, TailoredContent } from "@/lib/types";

export async function generateTailoredContent(
  parsed: ParsedJD,
  summaryCount: number,
  experienceCount: number,
  anthropicApiKey?: string
): Promise<TailoredContent> {
  const prompt = `
You are an expert C2C consulting resume writer for ${CANDIDATE_PROFILE.defaultRoleFamily} roles.
Return ONLY JSON:
{
  "summary_points": ["..."],
  "experience_points": ["..."],
  "skills_line": "...",
  "tailored_for_role": "...",
  "contract_alignment_note": "..."
}

Rules:
- summary_points count exactly ${summaryCount}
- experience_points count exactly ${experienceCount}
- concise, professional, contract-friendly
- Preserve factual integrity from JD and avoid invented claims.

Job description:
${parsed.raw_jd}

Parsed fields:
- title: ${parsed.title}
- company_or_vendor: ${parsed.company_or_vendor}
- location: ${parsed.location}
- contract_type: ${parsed.contract_type}
- role_track: ${parsed.role_track}
- required_terms: ${parsed.required_terms.join(", ")}
- extracted_skills: ${parsed.skills.join(", ")}
- fit_score: ${parsed.fit_score}
`;
  const text = await callClaudeWithFallback({
    prompt,
    family: "sonnet",
    preferredModel: appConfig.anthropicTailorModel,
    apiKey: anthropicApiKey,
    maxTokens: 1400,
    temperature: 0.3,
    attemptsPerModel: 2,
  });
  const data = extractJsonObject(text);
  const summary_points = Array.isArray(data.summary_points)
    ? data.summary_points.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const experience_points = Array.isArray(data.experience_points)
    ? data.experience_points.map((x) => String(x).trim()).filter(Boolean)
    : [];

  return {
    summary_points: (summary_points.concat(Array(summaryCount).fill("")).slice(0, summaryCount) as string[]),
    experience_points: (experience_points.concat(Array(experienceCount).fill("")).slice(0, experienceCount) as string[]),
    skills_line: String(data.skills_line ?? "").trim(),
    tailored_for_role: String(data.tailored_for_role ?? parsed.title ?? CANDIDATE_PROFILE.defaultRoleFamily).trim(),
    contract_alignment_note: String(data.contract_alignment_note ?? parsed.notes).trim(),
  };
}

export async function generateSubmissionEmail(parsed: ParsedJD, anthropicApiKey?: string): Promise<string> {
  const roleName = parsed.title || CANDIDATE_PROFILE.defaultRoleFamily;
  const companyName = parsed.company_or_vendor || "the team";
  const recruiterName = parsed.recruiter_name || "Hiring Team";
  const skillsText = parsed.skills.join(", ") || "data engineering and cloud technologies";
  const locationText = parsed.location || "Not specified";
  const prompt = `
Write a short, natural-sounding job application email from a candidate directly applying or submitting their profile to a vendor/recruiter.

Hard rules:
- Plain text only.
- No bullet points.
- Keep body under 150 words.
- Senior, concise, natural tone.
- Subject line must be exactly: Subject: [Role Name] – ${CANDIDATE_PROFILE.name}
- Must end with this exact signature block:
${signatureBlock()}

Variables:
- Job title: ${roleName}
- Company name: ${companyName}
- Location: ${locationText}
- Recruiter/Hiring manager name: ${recruiterName}
- Key skills from JD: ${skillsText}
`;
  return callClaudeWithFallback({
    prompt,
    family: "haiku",
    preferredModel: appConfig.anthropicEmailModel,
    apiKey: anthropicApiKey,
    maxTokens: 450,
    temperature: 0.2,
    attemptsPerModel: 2,
  });
}

export async function generateCoverLetter(parsed: ParsedJD, anthropicApiKey?: string): Promise<string> {
  const prompt = `
Write a professional one-page cover letter tailored to this company/role.

Hard requirements:
- Plain text only.
- Keep to one page max.
- Senior professional tone.
- Company/role specific.
- No placeholders.

Role: ${parsed.title}
Company/Vendor: ${parsed.company_or_vendor}
Location: ${parsed.location}
Contract type: ${parsed.contract_type}
Role track: ${parsed.role_track}
Required terms: ${parsed.required_terms.join(", ")}
Skills: ${parsed.skills.join(", ")}

Candidate:
- Name: ${CANDIDATE_PROFILE.name}
- Title: ${CANDIDATE_PROFILE.title}
- Email: ${CANDIDATE_PROFILE.email}
`;
  return callClaudeWithFallback({
    prompt,
    family: "haiku",
    preferredModel: appConfig.anthropicEmailModel,
    apiKey: anthropicApiKey,
    maxTokens: 900,
    temperature: 0.25,
    attemptsPerModel: 2,
  });
}

export async function generateCallIntro(parsed: ParsedJD, anthropicApiKey?: string): Promise<string> {
  const prompt = `
Write a short self-introduction script in 4-5 lines max for a candidate answering a recruiter call.

Requirements:
- Plain text only.
- First-person candidate voice ("Hi, this is ${CANDIDATE_PROFILE.name}...").
- Mention role fit and top relevant skills from JD.
- Candidate is receiving recruiter call (not recruiter script).
- End with a polite line to continue the conversation.

Candidate:
- Name: ${CANDIDATE_PROFILE.name}
- Profile: ${CANDIDATE_PROFILE.title}

Job context:
- Role: ${parsed.title}
- Company/Vendor: ${parsed.company_or_vendor}
- Location: ${parsed.location}
- Skills: ${parsed.skills.join(", ")}
- Role track: ${parsed.role_track}
`;
  return callClaudeWithFallback({
    prompt,
    family: "haiku",
    preferredModel: appConfig.anthropicEmailModel,
    apiKey: anthropicApiKey,
    maxTokens: 260,
    temperature: 0.25,
    attemptsPerModel: 2,
  });
}
