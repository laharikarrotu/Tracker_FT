import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import JSZip from "jszip";

export type ParsedJD = {
  raw_jd: string;
  title: string;
  company_or_vendor: string;
  recruiter_name: string;
  vendor_email: string;
  location: string;
  contract_type: string;
  remote_mode: string;
  pay_rate: string;
  job_id_url: string;
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

type DocxOptions = {
  maxSummaryReplacements: number;
  maxExperienceReplacements: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRetryAnthropicError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("timeout")
  );
}

function shouldRetryGoogleError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("backend error") ||
    msg.includes("internal error")
  );
}

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

function firstEmail(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() ?? "";
}

function firstURL(value: string): string {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  return match?.[0]?.trim() ?? "";
}

function safeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
    firstMatch(/(?:i am|i'm)\s+([^,\n]+)/i, rawJD) ||
    firstMatch(/(?:recruiter)\s*[:\-]\s*([^\n\r]+)/i, rawJD)
  );
  const vendor_email = safeText(
    firstMatch(/(?:share suitable profiles to|email)\s*[:\-]?\s*([^\s,\n]+)/i, rawJD) || firstEmail(rawJD)
  );
  const job_id_url = firstMatch(/(?:job id\s*\/\s*url|job id|requisition id)\s*[:\-]\s*([^\n\r]+)/i, rawJD) || firstURL(rawJD);
  const pay_rate = firstMatch(
    /(?:pay rate|rate|budget)\s*[:\-]\s*([^\n\r]+)/i,
    rawJD
  ) || firstMatch(/(\$\s*\d+[kK]?(?:\s*[-to]+\s*\$?\s*\d+[kK]?)?)/i, rawJD);
  const lower = rawJD.toLowerCase();
  const skills = DATA_ENGINEER_SKILLS.filter((skill) => lower.includes(skill)).sort();
  const is_contract_like = CONTRACT_TERMS.some((term) => lower.includes(term));
  const remote_mode =
    (lower.includes("hybrid") && "Hybrid") ||
    (lower.includes("remote") && "Remote") ||
    (lower.includes("onsite") && "Onsite") ||
    "";

  let fit_score = 0;
  if (lower.includes("data engineer") || lower.includes("data engineering")) fit_score += 40;
  fit_score += Math.min(skills.length * 6, 36);
  if (is_contract_like) fit_score += 24;
  fit_score = Math.min(fit_score, 100);

  return {
    raw_jd: rawJD,
    title,
    company_or_vendor: safeText(company_or_vendor),
    recruiter_name,
    vendor_email,
    location: safeText(location),
    contract_type: contract_type || (is_contract_like ? "Contract" : ""),
    remote_mode,
    pay_rate: safeText(pay_rate),
    job_id_url: safeText(job_id_url),
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

let discoveredModelIdsCache: { atMs: number; ids: string[] } | null = null;

async function discoverAvailableModelIds(client: Anthropic): Promise<string[]> {
  const now = Date.now();
  if (discoveredModelIdsCache && now - discoveredModelIdsCache.atMs < 10 * 60 * 1000) {
    return discoveredModelIdsCache.ids;
  }
  try {
    // SDK typing may vary by version; keep this resilient.
    const modelsApi = (client as unknown as { models?: { list: () => Promise<unknown> } }).models;
    if (!modelsApi?.list) return [];
    const listResponse = (await modelsApi.list()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string }>;
    };
    const items = listResponse.data || listResponse.models || [];
    const ids = items
      .map((m) => (m.id || "").trim())
      .filter((id) => id.toLowerCase().startsWith("claude-"));
    discoveredModelIdsCache = { atMs: now, ids };
    return ids;
  } catch {
    return [];
  }
}

function prioritizeModels(
  discoveredIds: string[],
  preferredConfigured: string,
  family: "sonnet" | "haiku"
): string[] {
  const preferred = preferredConfigured.trim();
  const discoveredFamily = discoveredIds.filter((id) => id.toLowerCase().includes(family));
  const discoveredOther = discoveredIds.filter((id) => !id.toLowerCase().includes(family));

  // Stable, known candidates as fallback when model listing is unavailable.
  const defaults =
    family === "sonnet"
      ? ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]
      : ["claude-3-haiku-20240307", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"];

  const ordered = [preferred, ...discoveredFamily, ...discoveredOther, ...defaults]
    .map((x) => x.trim())
    .filter(Boolean);

  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

async function callAnthropicWithPolicy(
  client: Anthropic,
  prompt: string,
  models: string[],
  maxRetries: number
): Promise<string> {

  let lastError: unknown = null;
  for (const model of models) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 1200,
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }]
        });
        return response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes("not_found")) {
          // Model alias unavailable; move to next model immediately.
          break;
        }
        if (attempt < maxRetries && shouldRetryAnthropicError(msg)) {
          await sleep(600 * attempt);
          continue;
        }
        // For non-retryable errors (auth, malformed input), fail fast.
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No Anthropic model is available for this API key.");
}

export async function generateTailoredContent(
  parsed: ParsedJD,
  summaryCount: number,
  experienceCount: number
): Promise<TailoredContent> {
  const client = anthropicClient();
  const preferred = (process.env.ANTHROPIC_TAILOR_MODEL || "").trim();
  const discovered = await discoverAvailableModelIds(client);
  const models = prioritizeModels(discovered, preferred, "sonnet");
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
- Preserve factual integrity from JD and avoid invented claims.

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

  const text = await callAnthropicWithPolicy(client, prompt, models, 2);
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
  const preferred = (process.env.ANTHROPIC_EMAIL_MODEL || "").trim();
  const discovered = await discoverAvailableModelIds(client);
  const models = prioritizeModels(discovered, preferred, "haiku");
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
  return callAnthropicWithPolicy(client, prompt, models, 2);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function paragraphText(paragraphXml: string): string {
  const text = Array.from(paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((m) => decodeXmlEntities(m[1]))
    .join("");
  return safeText(text);
}

function isBulletParagraph(paragraphXml: string, plainText: string): boolean {
  if (/<w:numPr[\s\S]*?<\/w:numPr>/.test(paragraphXml)) return true;
  return /^[-*•]/.test(plainText);
}

function replaceParagraphTextPreserveRuns(paragraphXml: string, newText: string): string {
  const first = paragraphXml.replace(
    /<w:t([^>]*)>[\s\S]*?<\/w:t>/,
    `<w:t$1>${xmlEscape(newText)}</w:t>`
  );
  return first.replace(/(<w:t[^>]*>)[\s\S]*?(<\/w:t>)/g, (m, a, b, idx) => {
    const firstIdx = first.indexOf("<w:t");
    return idx === firstIdx ? m : `${a}${b}`;
  });
}

function findHeaderIndex(paragraphs: string[], labels: string[]): number {
  const normalizedLabels = labels.map((x) => x.toLowerCase());
  for (let i = 0; i < paragraphs.length; i += 1) {
    const t = paragraphText(paragraphs[i]).toLowerCase();
    if (normalizedLabels.some((label) => t === label || t.includes(label))) return i;
  }
  return -1;
}

export async function generateTailoredDocxFromTemplate(
  templateDocxBase64: string,
  tailored: TailoredContent,
  options: DocxOptions
): Promise<string> {
  const cleaned = templateDocxBase64.replace(/^data:.*;base64,/, "");
  const zip = await JSZip.loadAsync(Buffer.from(cleaned, "base64"));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Invalid DOCX template: word/document.xml not found.");

  const xml = await file.async("text");
  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
  const matches = Array.from(xml.matchAll(paragraphRegex));
  const paragraphs = matches.map((m) => m[0]);
  if (paragraphs.length === 0) throw new Error("Invalid DOCX template: no paragraphs found.");

  const replacements = new Map<number, string>();
  const summaryHeader = findHeaderIndex(paragraphs, ["summary", "professional summary", "profile"]);
  const experienceHeader = findHeaderIndex(paragraphs, ["experience", "professional experience", "work experience"]);
  const skillsHeader = findHeaderIndex(paragraphs, ["skills", "technical skills", "core skills"]);

  const summaryEnd = [experienceHeader, skillsHeader, paragraphs.length].filter((x) => x > summaryHeader).sort((a, b) => a - b)[0];
  const expEnd = [skillsHeader, paragraphs.length].filter((x) => x > experienceHeader).sort((a, b) => a - b)[0];

  if (summaryHeader >= 0 && summaryEnd > summaryHeader) {
    const summaryBullets: number[] = [];
    for (let i = summaryHeader + 1; i < summaryEnd; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (txt && isBulletParagraph(paragraphs[i], txt)) summaryBullets.push(i);
    }
    const count = Math.min(options.maxSummaryReplacements, summaryBullets.length, tailored.summary_points.length);
    for (let i = 0; i < count; i += 1) {
      const idx = summaryBullets[i];
      replacements.set(idx, replaceParagraphTextPreserveRuns(paragraphs[idx], tailored.summary_points[i]));
    }
  }

  if (experienceHeader >= 0 && expEnd > experienceHeader) {
    const expBullets: number[] = [];
    for (let i = experienceHeader + 1; i < expEnd; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (txt && isBulletParagraph(paragraphs[i], txt)) expBullets.push(i);
    }
    const count = Math.min(
      options.maxExperienceReplacements,
      expBullets.length,
      tailored.experience_points.length
    );
    for (let i = 0; i < count; i += 1) {
      const idx = expBullets[i];
      replacements.set(idx, replaceParagraphTextPreserveRuns(paragraphs[idx], tailored.experience_points[i]));
    }
  }

  if (skillsHeader >= 0 && tailored.skills_line) {
    for (let i = skillsHeader + 1; i < paragraphs.length; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (!txt) continue;
      if (!isBulletParagraph(paragraphs[i], txt)) {
        replacements.set(i, replaceParagraphTextPreserveRuns(paragraphs[i], tailored.skills_line));
        break;
      }
    }
  }

  let built = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const start = m.index ?? 0;
    const original = m[0];
    built += xml.slice(cursor, start);
    built += replacements.get(i) ?? original;
    cursor = start + original.length;
  }
  built += xml.slice(cursor);

  zip.file("word/document.xml", built);
  const outBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return outBuffer.toString("base64");
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
      vendorname: args.parsed.recruiter_name || args.parsed.company_or_vendor,
      clientname: args.parsed.company_or_vendor,
      endclient: "",
      jobtitle: args.parsed.title,
      positiontitle: args.parsed.title,
      position: args.parsed.title,
      jobidurl: args.parsed.job_id_url,
      location: args.parsed.location,
      remotehybridonsite: args.parsed.remote_mode,
      contracttype: contractType,
      payrate: args.parsed.pay_rate,
      payratesubmitted: args.parsed.pay_rate,
      labelstatus: args.status,
      status: args.status,
      requirementsbrief: skillsBrief,
      requirements: skillsBrief,
      notes: note,
      generalnotes: note,
      followupdate: "",
      interviewdate: "",
      dayssinceapplied: "",
      vendoremail: args.parsed.vendor_email,
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

  const callWithSheetsRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < 3 && shouldRetryGoogleError(msg)) {
          await sleep(500 * attempt);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  const textEq = (a: string, b: string) =>
    normalize(a).replace(/portaljdpaste/g, "") === normalize(b).replace(/portaljdpaste/g, "");

  for (const tab of targetTabs) {
    const headerResp = await callWithSheetsRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${tab}!2:2`
      })
    );
    const headers = (headerResp.data.values?.[0] || []).map((x) => String(x).trim());
    if (headers.length === 0) {
      continue;
    }
    const row = headers.map((h) => headerToValue(h));

    // Upsert logic: update existing row when we can identify same opportunity/contact.
    const dataResp = await callWithSheetsRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${tab}!A3:ZZ`
      })
    );
    const values = dataResp.data.values || [];
    const normalizedHeaders = headers.map((h) => normalize(h));
    const idx = (key: string) => normalizedHeaders.indexOf(key);

    const iJobUrl = idx("jobidurl");
    const iTitle = Math.max(idx("jobtitle"), idx("positiontitle"), idx("position"));
    const iCompany = Math.max(idx("companyname"), idx("agencycompany"), idx("clientname"));
    const iVendorName = Math.max(idx("vendorname"), idx("vendorrecruiter"));
    const iVendorEmail = idx("vendoremail");

    let matchedRowNumber = -1;
    for (let r = 0; r < values.length; r += 1) {
      const rowVals = values[r];
      const jobUrlMatch =
        iJobUrl >= 0 &&
        args.parsed.job_id_url &&
        textEq(String(rowVals[iJobUrl] || ""), args.parsed.job_id_url);
      if (jobUrlMatch) {
        matchedRowNumber = r + 3;
        break;
      }
      let score = 0;
      if (iTitle >= 0 && args.parsed.title && textEq(String(rowVals[iTitle] || ""), args.parsed.title)) score += 1;
      if (
        iCompany >= 0 &&
        args.parsed.company_or_vendor &&
        textEq(String(rowVals[iCompany] || ""), args.parsed.company_or_vendor)
      )
        score += 1;
      if (
        iVendorName >= 0 &&
        (args.parsed.recruiter_name || args.parsed.company_or_vendor) &&
        textEq(
          String(rowVals[iVendorName] || ""),
          args.parsed.recruiter_name || args.parsed.company_or_vendor
        )
      )
        score += 1;
      if (iVendorEmail >= 0 && args.parsed.vendor_email && textEq(String(rowVals[iVendorEmail] || ""), args.parsed.vendor_email))
        score += 1;

      if (score >= 3 || (score >= 2 && Boolean(args.parsed.vendor_email))) {
        matchedRowNumber = r + 3;
        break;
      }
    }

    if (matchedRowNumber > 0) {
      await callWithSheetsRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tab}!A${matchedRowNumber}:ZZ${matchedRowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] }
        })
      );
    } else {
      await callWithSheetsRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${tab}!A:ZZ`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] }
        })
      );
    }
  }
}
