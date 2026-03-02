import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";

export type ParsedJD = {
  raw_jd: string;
  title: string;
  company_or_vendor: string;
  location: string;
  contract_type: string;
  skills: string[];
  notes: string;
  is_contract_like: boolean;
  fit_score: number;
};

export type TailoredContent = {
  summary_points: string[];
  experience_points: string[];
  skills_line: string;
  tailored_for_role: string;
  contract_alignment_note: string;
};

const CONTRACT_TERMS = ["contract", "c2c", "corp-to-corp", "w2", "1099", "contractor", "vendor"];
const DATA_ENGINEER_SKILLS = [
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
  "data pipeline",
  "kafka",
  "redshift",
  "bigquery"
];

function firstMatch(pattern: RegExp, value: string): string {
  const match = value.match(pattern);
  return match?.[1]?.trim() ?? "";
}

export function parseJobDescription(rawJD: string): ParsedJD {
  const lines = rawJD.split("\n").map((x) => x.trim()).filter(Boolean);
  const defaultTitle = lines[0]?.slice(0, 120) ?? "Data Engineer";
  const title = firstMatch(/(?:title|position|role)\s*[:\-]\s*([^\n\r]+)/i, rawJD) || defaultTitle;
  const company_or_vendor = firstMatch(/(?:company|client|vendor)\s*[:\-]\s*([^\n\r]+)/i, rawJD);
  const location = firstMatch(/(?:location)\s*[:\-]\s*([^\n\r]+)/i, rawJD);
  const contract_type = firstMatch(/(?:employment type|contract type|type)\s*[:\-]\s*([^\n\r]+)/i, rawJD);
  const lower = rawJD.toLowerCase();
  const skills = DATA_ENGINEER_SKILLS.filter((skill) => lower.includes(skill)).sort();
  const is_contract_like = CONTRACT_TERMS.some((term) => lower.includes(term));

  let fit_score = 0;
  if (lower.includes("data engineer") || lower.includes("data engineering")) fit_score += 40;
  fit_score += Math.min(skills.length * 6, 36);
  if (is_contract_like) fit_score += 24;
  fit_score = Math.min(fit_score, 100);

  return {
    raw_jd: rawJD,
    title,
    company_or_vendor,
    location,
    contract_type,
    skills,
    notes: is_contract_like ? "Contract-focused fit" : "Needs manual contract check",
    is_contract_like,
    fit_score
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
    contract_type: overrides.override_contract?.trim() || parsed.contract_type
  };
}

export function enforceContractMode(parsed: ParsedJD) {
  const strict = (process.env.STRICT_CONTRACT_MODE ?? "true").toLowerCase() === "true";
  if (strict && !parsed.is_contract_like) {
    throw new Error("JD is not contract/C2C-like while strict mode is enabled.");
  }
}

function extractJSON(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Model did not return valid JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function anthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY.");
  return new Anthropic({ apiKey });
}

export async function generateTailoredContent(
  parsed: ParsedJD,
  summaryCount: number,
  experienceCount: number
): Promise<TailoredContent> {
  const client = anthropicClient();
  const prompt = `
You are an expert C2C consulting resume writer for Data Engineer roles.
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

Job description:
${parsed.raw_jd}

Parsed fields:
- title: ${parsed.title}
- company_or_vendor: ${parsed.company_or_vendor}
- location: ${parsed.location}
- contract_type: ${parsed.contract_type}
- extracted_skills: ${parsed.skills.join(", ")}
- fit_score: ${parsed.fit_score}
`;

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1600,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const data = extractJSON(text);

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
    tailored_for_role: String(data.tailored_for_role ?? parsed.title ?? "Data Engineer").trim(),
    contract_alignment_note: String(data.contract_alignment_note ?? parsed.notes).trim()
  };
}

export async function generateSubmissionEmail(parsed: ParsedJD): Promise<string> {
  const client = anthropicClient();
  const prompt = `
Write a concise, professional C2C submission email for a Data Engineer role.
Return plain text only, under 180 words.
Include Subject line, greeting, 3-5 match highlights, contract-friendly note, and closing.

Role: ${parsed.title}
Company/Vendor: ${parsed.company_or_vendor}
Location: ${parsed.location}
Contract type: ${parsed.contract_type}
Skills: ${parsed.skills.join(", ")}
`;
  const response = await client.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 450,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }]
  });
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function appendToGoogleSheet(args: {
  parsed: ParsedJD;
  status: string;
  outputPath?: string;
  notes?: string;
}) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetTab = process.env.GOOGLE_SHEET_TAB || "Applications";
  const serviceAccountRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !serviceAccountRaw) throw new Error("Missing Google Sheets environment variables.");

  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(serviceAccountRaw);
  } catch {
    // Accept base64-encoded JSON as a fallback format in Vercel env vars.
    try {
      const decoded = Buffer.from(serviceAccountRaw, "base64").toString("utf8");
      credentials = JSON.parse(decoded);
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste raw JSON or base64-encoded JSON."
      );
    }
  }
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const sheets = google.sheets({ version: "v4", auth });

  const now = new Date();
  const nowISO = now.toISOString();
  const contractType = args.parsed.contract_type || (args.parsed.is_contract_like ? "C2C/Contract" : "");
  const skillsBrief = args.parsed.skills.join(", ");
  const note = args.notes || args.parsed.notes;

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tabNorm = (value: string) => normalize(value).replace(/dashboard|howtouse/g, "");
  const headerToValue = (header: string): string => {
    const h = normalize(header);
    const map: Record<string, string> = {
      dateapplied: nowISO,
      submissiondate: nowISO,
      platformsource: "Portal/JD Paste",
      platformused: "Portal/JD Paste",
      platform: "Portal/JD Paste",
      companyname: args.parsed.company_or_vendor,
      agencycompany: args.parsed.company_or_vendor,
      vendorrecruiter: args.parsed.company_or_vendor,
      vendorname: args.parsed.company_or_vendor,
      clientname: args.parsed.company_or_vendor,
      endclient: "",
      jobtitle: args.parsed.title,
      positiontitle: args.parsed.title,
      position: args.parsed.title,
      jobidurl: "",
      location: args.parsed.location,
      remotehybridonsite: "",
      contracttype: contractType,
      payrate: "",
      payratesubmitted: "",
      labelstatus: args.status,
      status: args.status,
      requirementsbrief: skillsBrief,
      requirements: skillsBrief,
      notes: note,
      generalnotes: note,
      followupdate: "",
      interviewdate: "",
      dayssinceapplied: "",
      vendoremail: "",
      vendorphone: "",
      confirmaton: "",
      confirmation: "",
      interviewcalled: "",
      outcome: "",
      timessubmitted: "",
      companyinemail: "",
      passport: "",
      passportno: "",
      fitscore: String(args.parsed.fit_score),
      resumeoutputpath: args.outputPath || ""
    };
    return map[h] ?? "";
  };

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(title))"
  });
  const titles = (metadata.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter((x): x is string => Boolean(x));

  const pickTitle = (keyword: string) =>
    titles.find((t) => tabNorm(t).includes(keyword)) || null;

  const targetTabs = [
    pickTitle("applications"),
    pickTitle("vendordb"),
    pickTitle("submissions")
  ].filter((x): x is string => Boolean(x));

  // Fallback to configured tab if the expected tabs are not found.
  if (targetTabs.length === 0) {
    targetTabs.push(sheetTab);
  }

  for (const tab of targetTabs) {
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!2:2`
    });
    const headers = (headerResp.data.values?.[0] || []).map((x) => String(x).trim());
    if (headers.length === 0) {
      continue;
    }
    const row = headers.map((h) => headerToValue(h));
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A:ZZ`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] }
    });
  }
}
