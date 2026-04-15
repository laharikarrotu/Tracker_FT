import { callClaudeWithFallback } from "@/lib/anthropic";
import { appConfig } from "@/lib/config";
import { extractJsonObject } from "@/lib/common";
import { CANDIDATE_PROFILE, CANDIDATE_PROFILE_CONTEXT, signatureBlock } from "@/lib/profile";
import type { ATSAnalysis, FitScoreBreakdown, ParsedJD, TailoredContent } from "@/lib/types";

function normalizeLine(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeBullet(text: unknown): string {
  return String(text ?? "")
    .replace(/^[\s*•\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ATS_STOP_WORDS = new Set([
  "the", "and", "or", "with", "for", "to", "of", "in", "on", "a", "an", "is", "are", "be", "as", "such",
  "strong", "ability", "skills", "experience", "professional", "years", "year", "plus", "hands", "using",
  "building", "designing", "supporting", "modern", "across", "teams",
]);

function resolveRequiredTerms(parsed: ParsedJD): string[] {
  const base = parsed.must_have_terms.length
    ? parsed.must_have_terms
    : (parsed.required_terms.length ? parsed.required_terms : parsed.skills);
  const normalized = Array.from(new Set(base.map((x) => x.trim().toLowerCase()).filter(Boolean)));
  const longRatio = normalized.length
    ? normalized.filter((x) => x.length > 60 || x.split(/\s+/).filter(Boolean).length > 8).length / normalized.length
    : 0;
  if (longRatio > 0.4 && parsed.skills.length) {
    return Array.from(new Set(parsed.skills.map((x) => x.trim().toLowerCase()).filter(Boolean)));
  }
  return normalized;
}

function inferRoleMode(parsed: ParsedJD): "backend" | "full-stack" | "ai-agent" {
  const text = `${parsed.title} ${parsed.raw_jd}`.toLowerCase();
  if (/agent|langgraph|crewai|rag|llm|genai|gpt|bedrock|gemini/.test(text)) return "ai-agent";
  if (/react|next\.js|frontend|full[- ]?stack|ui/.test(text)) return "full-stack";
  return "backend";
}

function coverageForTerms(terms: string[], text: string): ATSAnalysis {
  const lower = text.toLowerCase();
  const tokenMatch = (term: string): boolean => {
    if (!term.trim()) return false;
    if (lower.includes(term)) return true;
    const tokens = term
      .split(/[^a-z0-9.+#-]+/i)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.length >= 3 && !ATS_STOP_WORDS.has(x));
    if (!tokens.length) return false;
    const hits = tokens.filter((t) => lower.includes(t)).length;
    const ratio = hits / tokens.length;
    return hits >= 2 && ratio >= 0.45;
  };
  const covered_terms = terms.filter((term) => tokenMatch(term));
  const covered = new Set(covered_terms);
  const missing_terms = terms.filter((term) => !covered.has(term));
  return {
    required_terms: terms,
    covered_terms,
    missing_terms,
    coverage_ratio: terms.length ? covered_terms.length / terms.length : 1,
  };
}

const GENERIC_BULLET_PATTERNS = [
  /\bresponsible for\b/i,
  /\bworked on\b/i,
  /\binvolved in\b/i,
  /\bvarious tasks\b/i,
  /\bhandled multiple\b/i,
];

function detectUnknownEntities(parsed: ParsedJD, tailored: TailoredContent): string[] {
  const generated = `${tailored.summary_points.join(" ")} ${tailored.experience_points.join(" ")} ${tailored.skills_line}`.trim();
  if (!generated) return [];
  const allowedCorpus = `${CANDIDATE_PROFILE_CONTEXT} ${parsed.raw_jd}`.toLowerCase();
  const entities = Array.from(generated.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)).map((m) => m[1].trim());
  const unknown = entities.filter((entity) => !allowedCorpus.includes(entity.toLowerCase()));
  return Array.from(new Set(unknown));
}

export function validateTailoredQuality(parsed: ParsedJD, tailored: TailoredContent): string[] {
  const issues: string[] = [];
  const allBullets = [...tailored.summary_points, ...tailored.experience_points].map((x) => x.trim()).filter(Boolean);
  if (!tailored.summary_points.some((x) => x.trim())) issues.push("Summary bullets are empty.");
  if (!tailored.experience_points.some((x) => x.trim())) issues.push("Experience bullets are empty.");
  if (!tailored.skills_line.trim()) issues.push("Skills line is empty.");
  for (const bullet of allBullets) {
    const wc = bullet.split(/\s+/).filter(Boolean).length;
    if (wc < 8) issues.push(`Bullet too short: "${bullet}"`);
    if (GENERIC_BULLET_PATTERNS.some((r) => r.test(bullet))) issues.push(`Generic bullet phrasing: "${bullet}"`);
  }
  // Keep checks lightweight and avoid noisy entity warnings.
  return issues;
}

export function buildAtsAnalysis(parsed: ParsedJD, text: string): ATSAnalysis {
  return coverageForTerms(resolveRequiredTerms(parsed), text);
}

export function computeFitScoreBreakdown(
  parsed: ParsedJD,
  tailored: TailoredContent,
  beforeResumeText: string,
  afterResumeText: string,
  targetRoleMode: "auto" | "backend" | "full-stack" | "ai-agent" = "auto"
): FitScoreBreakdown {
  const generatedEnough =
    tailored.summary_points.filter((x) => x.trim().length > 0).length >= 1 &&
    tailored.experience_points.filter((x) => x.trim().length > 0).length >= 1 &&
    tailored.skills_line.trim().length > 0;

  const required = resolveRequiredTerms(parsed);
  const roleMode = targetRoleMode === "auto" ? inferRoleMode(parsed) : targetRoleMode;
  const roleWeight = roleMode === "ai-agent" ? 0.75 : roleMode === "full-stack" ? 0.72 : 0.7;
  const beforeCoverage = coverageForTerms(required, beforeResumeText);

  const text = [
    afterResumeText,
    tailored.summary_points.join(" "),
    tailored.experience_points.join(" "),
    tailored.skills_line,
    tailored.tailored_for_role,
    parsed.title,
  ]
    .join(" ")
    .toLowerCase();
  const afterCoverage = coverageForTerms(required, text);

  const completenessChecks = [
    tailored.summary_points.some((x) => x.trim().length > 0),
    tailored.experience_points.some((x) => x.trim().length > 0),
    tailored.skills_line.trim().length > 0,
  ];
  const completenessRatio = completenessChecks.filter(Boolean).length / completenessChecks.length;
  const baselineScore = Math.max(parsed.fit_score, 1);

  let rawScore: number;
  if (!required.length) {
    rawScore = Math.max(parsed.fit_score, generatedEnough ? Math.min(parsed.fit_score + 5, 100) : parsed.fit_score);
  } else {
    const coverageScore = afterCoverage.coverage_ratio * 100;
    rawScore = Math.round((coverageScore * roleWeight) + (baselineScore * 0.2) + (completenessRatio * 10));
  }

  const tailoredScore = Math.max(1, Math.min(generatedEnough ? rawScore : rawScore - 5, 100));
  return {
    target_role_mode: targetRoleMode,
    baseline_fit_score: baselineScore,
    tailored_fit_score: tailoredScore,
    completeness_ratio: completenessRatio,
    coverage_before_ratio: beforeCoverage.coverage_ratio,
    coverage_after_ratio: afterCoverage.coverage_ratio,
    required_terms: required,
    covered_before_terms: beforeCoverage.covered_terms,
    covered_after_terms: afterCoverage.covered_terms,
    missing_before_terms: beforeCoverage.missing_terms,
    missing_after_terms: afterCoverage.missing_terms,
  };
}

export function computeTailoredFitScore(parsed: ParsedJD, tailored: TailoredContent, fullResumeText = ""): number {
  const breakdown = computeFitScoreBreakdown(parsed, tailored, "", fullResumeText, "auto");
  return breakdown.tailored_fit_score;
}

export async function generateTailoredContent(
  parsed: ParsedJD,
  summaryCount: number,
  experienceCount: number,
  targetRoleMode: "auto" | "backend" | "full-stack" | "ai-agent" = "auto",
  anthropicApiKey?: string,
  customTailorPrompt?: string
): Promise<TailoredContent> {
  const roleMode = targetRoleMode === "auto" ? inferRoleMode(parsed) : targetRoleMode;
  const roleModeInstruction =
    roleMode === "ai-agent"
      ? "Prioritize AI agent systems, RAG, orchestration, governance, and production reliability."
      : roleMode === "full-stack"
        ? "Prioritize full-stack impact, APIs, backend reliability, and frontend integration quality."
        : "Prioritize backend API scalability, data pipelines, cloud infra, and performance tuning.";
  const customPromptSection = normalizeLine(customTailorPrompt)
    ? `
Additional user instructions (highest priority if factual and non-contradictory):
${normalizeLine(customTailorPrompt)}
`
    : "";
  const prompt = `
You are an expert full-time resume writer for ${CANDIDATE_PROFILE.defaultRoleFamily} roles.
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
- concise, professional, full-time friendly
- Preserve factual integrity from JD and avoid invented claims.
- Keep every summary bullet to one line and around 20-22 words.
- Keep every experience bullet to one line and around 25-28 words.
- Do NOT include bullet symbols (no "-", "*", or "•"), the DOCX already has bullet formatting.
- Keep skills_line compact (around 20-26 words).
- Goal: content should fit in a typical 2-page resume template.
- Role target mode: ${roleMode}
- ${roleModeInstruction}
- Keep all content aligned to this candidate profile context (no invented employers, timelines, or tools):
${CANDIDATE_PROFILE_CONTEXT}

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
${customPromptSection}
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
    ? data.summary_points.map((x) => normalizeBullet(x)).filter(Boolean)
    : [];
  const experience_points = Array.isArray(data.experience_points)
    ? data.experience_points.map((x) => normalizeBullet(x)).filter(Boolean)
    : [];

  return {
    summary_points: (summary_points.concat(Array(summaryCount).fill("")).slice(0, summaryCount) as string[]),
    experience_points: (experience_points.concat(Array(experienceCount).fill("")).slice(0, experienceCount) as string[]),
    skills_line: normalizeLine(data.skills_line),
    tailored_for_role: normalizeLine(data.tailored_for_role ?? parsed.title ?? CANDIDATE_PROFILE.defaultRoleFamily),
    contract_alignment_note: normalizeLine(data.contract_alignment_note ?? parsed.notes),
  };
}

export async function generateSubmissionEmail(parsed: ParsedJD, anthropicApiKey?: string): Promise<string> {
  const roleName = parsed.title || CANDIDATE_PROFILE.defaultRoleFamily;
  const companyName = parsed.company_or_vendor || "the team";
  const recruiterName = parsed.recruiter_name || "Hiring Team";
  const skillsText = parsed.skills.join(", ") || "data engineering and cloud technologies";
  const locationText = parsed.location || "Not specified";
  const prompt = `
Write a short, natural-sounding job application email from a candidate directly applying to a company or hiring team.

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
- Candidate profile context:
${CANDIDATE_PROFILE_CONTEXT}
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
Company/Hiring Team: ${parsed.company_or_vendor}
Location: ${parsed.location}
Contract type: ${parsed.contract_type}
Role track: ${parsed.role_track}
Required terms: ${parsed.required_terms.join(", ")}
Skills: ${parsed.skills.join(", ")}

Candidate:
- Name: ${CANDIDATE_PROFILE.name}
- Title: ${CANDIDATE_PROFILE.title}
- Email: ${CANDIDATE_PROFILE.email}
- Profile context:
${CANDIDATE_PROFILE_CONTEXT}
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
- Company/Hiring Team: ${parsed.company_or_vendor}
- Location: ${parsed.location}
- Skills: ${parsed.skills.join(", ")}
- Role track: ${parsed.role_track}
- Candidate profile context:
${CANDIDATE_PROFILE_CONTEXT}
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
