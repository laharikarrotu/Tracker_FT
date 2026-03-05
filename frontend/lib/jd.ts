import { appConfig } from "@/lib/config";
import { callClaudeWithFallback } from "@/lib/anthropic";
import { AppError, extractJsonObject, safeText } from "@/lib/common";
import type { ClaudeExtraction, ParsedJD } from "@/lib/types";

const CONTRACT_TERMS = ["contract", "c2c", "corp-to-corp", "w2", "1099", "contractor", "vendor"];
const BASELINE_CANDIDATE_SKILLS = new Set([
  "python",
  "pyspark",
  "spark",
  "sql",
  "snowflake",
  "airflow",
  "dbt",
  "databricks",
  "aws",
  "azure",
  "gcp",
  "etl",
  "kafka",
  "redshift",
  "bigquery",
  "data modeling",
  "data warehousing",
]);

const SKILL_PATTERNS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: "python", pattern: /\bpython\b/i },
  { canonical: "pyspark", pattern: /\bpyspark\b/i },
  { canonical: "spark", pattern: /\bspark\b/i },
  { canonical: "sql", pattern: /\bsql\b/i },
  { canonical: "snowflake", pattern: /\bsnowflake\b/i },
  { canonical: "airflow", pattern: /\bairflow\b/i },
  { canonical: "dbt", pattern: /\bdbt\b/i },
  { canonical: "databricks", pattern: /\bdatabricks\b/i },
  { canonical: "aws", pattern: /\baws\b|amazon web services/i },
  { canonical: "azure", pattern: /\bazure\b/i },
  { canonical: "gcp", pattern: /\bgcp\b|google cloud platform/i },
  { canonical: "etl", pattern: /\betl\b|extract[\s-]?transform[\s-]?load/i },
  { canonical: "kafka", pattern: /\bkafka\b/i },
  { canonical: "redshift", pattern: /\bredshift\b/i },
  { canonical: "bigquery", pattern: /\bbigquery\b/i },
  { canonical: "teradata", pattern: /\bteradata\b/i },
  { canonical: "tableau", pattern: /\btableau\b/i },
  { canonical: "power bi", pattern: /\bpower\s*bi\b/i },
  { canonical: "sap business objects", pattern: /\bsap\s*business\s*object/i },
  { canonical: "salesforce", pattern: /\bsalesforce\b/i },
  { canonical: "data modeling", pattern: /\bdata model/i },
  { canonical: "data warehousing", pattern: /\bdata warehous/i },
];

const ROLE_TRACK_HINTS: Record<string, string[]> = {
  salesforce: ["salesforce", "crm", "apex", "soql"],
  azure: ["azure", "adf", "synapse", "azure databricks"],
  aws: ["aws", "glue", "redshift", "emr", "s3"],
  gcp: ["gcp", "bigquery", "dataflow", "pubsub"],
  databricks: ["databricks", "delta lake", "spark"],
  snowflake: ["snowflake"],
};

function firstMatch(pattern: RegExp, value: string): string {
  const match = value.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function firstEmail(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() ?? "";
}

function firstUrl(value: string): string {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  return match?.[0]?.trim() ?? "";
}

function firstPhone(value: string): string {
  const match = value.match(/(?:\+\d{1,2}\s*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/);
  return match?.[0]?.trim() ?? "";
}

function extractSkills(rawJD: string): string[] {
  const found: string[] = [];
  for (const item of SKILL_PATTERNS) {
    if (item.pattern.test(rawJD)) found.push(item.canonical);
  }
  return Array.from(new Set(found)).sort();
}

function extractRequiredTerms(rawJD: string): string[] {
  const lines = rawJD.split("\n").map((x) => x.trim()).filter(Boolean);
  const requiredLines = lines.filter((line) =>
    /required|must have|key responsibilities|required qualifications|experience in|top skills/i.test(line)
  );
  const terms = new Set<string>();
  for (const line of requiredLines) {
    for (const item of SKILL_PATTERNS) {
      if (item.pattern.test(line)) terms.add(item.canonical);
    }
  }
  return Array.from(terms);
}

function inferRoleTrack(title: string, rawJD: string): string {
  const text = `${title}\n${rawJD}`.toLowerCase();
  let best = "general";
  let bestScore = 0;
  for (const [track, hints] of Object.entries(ROLE_TRACK_HINTS)) {
    const score = hints.reduce((acc, h) => (text.includes(h) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return best;
}

function parseYearsRequired(rawJD: string): number {
  const matches = Array.from(rawJD.matchAll(/(\d+)\s*\+?\s*years?/gi));
  if (!matches.length) return 0;
  return Math.max(...matches.map((m) => Number(m[1] || 0)));
}

export function computeFitScore(input: {
  title: string;
  rawJD: string;
  skills: string[];
  required_terms: string[];
  role_track: string;
  is_contract_like: boolean;
}): number {
  const lower = input.rawJD.toLowerCase();
  const yearsRequired = parseYearsRequired(input.rawJD);
  let fitScore = lower.includes("data engineer") || lower.includes("data engineering") ? 30 : 10;
  const requiredCoverageBase = input.required_terms.length ? input.required_terms : input.skills;
  const coveredRequired = requiredCoverageBase.filter((s) => BASELINE_CANDIDATE_SKILLS.has(s)).length;
  fitScore += requiredCoverageBase.length
    ? Math.round((coveredRequired / requiredCoverageBase.length) * 45)
    : Math.min(input.skills.length * 4, 30);
  if (input.role_track !== "general") fitScore += 10;
  if (input.is_contract_like) fitScore += 10;
  if (yearsRequired > 0 && yearsRequired <= 10) fitScore += 5;
  return Math.max(1, Math.min(fitScore, 100));
}

export function parseJobDescription(rawJD: string): ParsedJD {
  const lines = rawJD.split("\n").map((x) => x.trim()).filter(Boolean);
  const defaultTitle = lines[0]?.slice(0, 120) ?? "Data Engineer";
  const title = firstMatch(/(?:title|position|role)\s*[:\-]\s*([^\n\r]+)/i, rawJD) || defaultTitle;
  const company_or_vendor =
    firstMatch(/(?:company|client|vendor)\s*[:\-]\s*([^\n\r]+)/i, rawJD) ||
    firstMatch(/from\s+([A-Za-z0-9 .&-]+?)(?:[\n,]|please find|role:|position:)/i, rawJD);
  const location = firstMatch(/(?:location)\s*[:\-]\s*([^\n\r]+)/i, rawJD);
  const contract_type = firstMatch(/(?:employment type|contract type|type)\s*[:\-]\s*([^\n\r]+)/i, rawJD);
  const recruiter_name = safeText(
    firstMatch(/(?:i am|i'm)\s+([^,\n]+)/i, rawJD) || firstMatch(/(?:recruiter)\s*[:\-]\s*([^\n\r]+)/i, rawJD)
  );
  const vendor_email = safeText(
    firstMatch(/(?:share suitable profiles to|email)\s*[:\-]?\s*([^\s,\n]+)/i, rawJD) || firstEmail(rawJD)
  );
  const vendor_phone = safeText(
    firstMatch(/(?:phone|mobile|contact)\s*[:\-]\s*([^\n\r]+)/i, rawJD) || firstPhone(rawJD)
  );
  const job_id_url =
    firstMatch(/(?:job id\s*\/\s*url|job id|requisition id)\s*[:\-]\s*([^\n\r]+)/i, rawJD) || firstUrl(rawJD);
  const pay_rate =
    firstMatch(/(?:pay rate|rate|budget)\s*[:\-]\s*([^\n\r]+)/i, rawJD) ||
    firstMatch(/(\$\s*\d+[kK]?(?:\s*[-to]+\s*\$?\s*\d+[kK]?)?)/i, rawJD);
  const lower = rawJD.toLowerCase();
  const skills = extractSkills(rawJD);
  const is_contract_like = CONTRACT_TERMS.some((term) => lower.includes(term));
  const role_track = inferRoleTrack(title, rawJD);
  const required_terms = extractRequiredTerms(rawJD);
  const remote_mode =
    (lower.includes("hybrid") && "Hybrid") || (lower.includes("remote") && "Remote") || (lower.includes("onsite") && "Onsite") || "";

  const fit_score = computeFitScore({
    title,
    rawJD,
    skills,
    required_terms,
    role_track,
    is_contract_like,
  });

  return {
    raw_jd: rawJD,
    title,
    company_or_vendor: safeText(company_or_vendor),
    recruiter_name,
    vendor_email,
    vendor_phone,
    location: safeText(location),
    contract_type: contract_type || (is_contract_like ? "Contract" : ""),
    remote_mode,
    pay_rate: safeText(pay_rate),
    job_id_url: safeText(job_id_url),
    skills,
    role_track,
    required_terms,
    notes: is_contract_like ? "Contract-focused fit" : "Needs manual contract check",
    is_contract_like,
    fit_score,
  };
}

export function applyOverrides(
  parsed: ParsedJD,
  overrides: {
    override_title?: string;
    override_company?: string;
    override_location?: string;
    override_contract?: string;
  }
): ParsedJD {
  return {
    ...parsed,
    title: overrides.override_title?.trim() || parsed.title,
    company_or_vendor: overrides.override_company?.trim() || parsed.company_or_vendor,
    location: overrides.override_location?.trim() || parsed.location,
    contract_type: overrides.override_contract?.trim() || parsed.contract_type,
  };
}

function parseClaudeExtraction(text: string): ClaudeExtraction {
  const data = extractJsonObject(text) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => safeText(String(x))).filter(Boolean) : []);
  const str = (v: unknown) => safeText(String(v ?? ""));
  return {
    title: str(data.title),
    company_or_vendor: str(data.company_or_vendor),
    recruiter_name: str(data.recruiter_name),
    vendor_email: str(data.vendor_email),
    vendor_phone: str(data.vendor_phone),
    location: str(data.location),
    contract_type: str(data.contract_type),
    remote_mode: str(data.remote_mode),
    pay_rate: str(data.pay_rate),
    job_id_url: str(data.job_id_url),
    skills: arr(data.skills),
    role_track: str(data.role_track),
    required_terms: arr(data.required_terms),
  };
}

export async function enrichParsedJDWithClaude(rawJD: string, baseline: ParsedJD): Promise<ParsedJD> {
  if (!appConfig.claudeExtractionEnabled) return baseline;
  const prompt = `
Extract job-description fields as strict JSON. Do not invent data.
If missing, return empty string "" or [].

Schema:
{
  "title": "",
  "company_or_vendor": "",
  "recruiter_name": "",
  "vendor_email": "",
  "vendor_phone": "",
  "location": "",
  "contract_type": "",
  "remote_mode": "",
  "pay_rate": "",
  "job_id_url": "",
  "skills": [],
  "role_track": "",
  "required_terms": []
}

role_track should be one of:
general, salesforce, azure, aws, gcp, databricks, snowflake

JD:
${rawJD}
`;

  try {
    const text = await callClaudeWithFallback({
      prompt,
      family: "haiku",
      preferredModel: appConfig.anthropicExtractionModel,
      maxTokens: 700,
      temperature: 0.1,
      attemptsPerModel: 4,
    });
    const extracted = parseClaudeExtraction(text);
    const mergeList = (a: string[], b?: string[]) => Array.from(new Set([...(a || []), ...((b || []).filter(Boolean))]));
    const merged: ParsedJD = {
      ...baseline,
      title: extracted.title || baseline.title,
      company_or_vendor: extracted.company_or_vendor || baseline.company_or_vendor,
      recruiter_name: extracted.recruiter_name || baseline.recruiter_name,
      vendor_email: extracted.vendor_email || baseline.vendor_email,
      vendor_phone: extracted.vendor_phone || baseline.vendor_phone,
      location: extracted.location || baseline.location,
      contract_type: extracted.contract_type || baseline.contract_type,
      remote_mode: extracted.remote_mode || baseline.remote_mode,
      pay_rate: extracted.pay_rate || baseline.pay_rate,
      job_id_url: extracted.job_id_url || baseline.job_id_url,
      skills: mergeList(baseline.skills, extracted.skills),
      role_track: extracted.role_track || baseline.role_track,
      required_terms: mergeList(baseline.required_terms, extracted.required_terms),
      is_contract_like:
        baseline.is_contract_like ||
        /contract|c2c|w2|1099/i.test(extracted.contract_type || "") ||
        /contract|c2c|w2|1099/i.test(rawJD),
    };
    merged.fit_score = computeFitScore({
      title: merged.title,
      rawJD,
      skills: merged.skills,
      required_terms: merged.required_terms,
      role_track: merged.role_track,
      is_contract_like: merged.is_contract_like,
    });
    return merged;
  } catch (error) {
    if (appConfig.claudeExtractionOnly) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new AppError(`Claude extraction failed: ${msg}`);
    }
    return baseline;
  }
}
