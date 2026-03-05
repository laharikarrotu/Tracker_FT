import { google } from "googleapis";
import { appConfig } from "@/lib/config";
import { AppError, retryWithBackoff } from "@/lib/common";
import type { ParsedJD } from "@/lib/types";

type SheetRuntimeConfig = {
  googleSheetId?: string;
  googleSheetTab?: string;
  googleServiceAccountJson?: string;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tabNorm(value: string): string {
  return normalize(value).replace(/dashboard|howtouse/g, "");
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

function columnNumberToLetters(num: number): string {
  let n = Math.max(1, num);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function withSheetsRetry<T>(fn: () => Promise<T>): Promise<T> {
  return retryWithBackoff({ attempts: 3, shouldRetry: shouldRetryGoogleError, task: fn });
}

function textEq(a: string, b: string): boolean {
  return normalize(a).replace(/portaljdpaste/g, "") === normalize(b).replace(/portaljdpaste/g, "");
}

function firstHeaderIndex(normalizedHeaders: string[], keys: string[]): number {
  for (const key of keys) {
    const i = normalizedHeaders.indexOf(key);
    if (i >= 0) return i;
  }
  return -1;
}

function parseServiceAccount(serviceAccountRaw: string): Record<string, string> {
  try {
    return JSON.parse(serviceAccountRaw);
  } catch {
    try {
      const decoded = Buffer.from(serviceAccountRaw, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch {
      throw new AppError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is invalid. Provide raw JSON or base64-encoded JSON."
      );
    }
  }
}

async function getSheetsClient(config?: SheetRuntimeConfig) {
  const sheetId = (config?.googleSheetId || process.env.GOOGLE_SHEET_ID || "").trim();
  const serviceAccountRaw = (
    config?.googleServiceAccountJson ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    ""
  ).trim();
  if (!sheetId || !serviceAccountRaw) {
    throw new AppError("Missing Google Sheets configuration: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID.");
  }
  const credentials = parseServiceAccount(serviceAccountRaw);
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheetId, sheets: google.sheets({ version: "v4", auth }) };
}

export async function appendToGoogleSheet(args: {
  parsed: ParsedJD;
  status: string;
  outputPath?: string;
  notes?: string;
  callIntro?: string;
  config?: SheetRuntimeConfig;
}) {
  const { sheetId, sheets } = await getSheetsClient(args.config);
  const nowISO = new Date().toISOString();
  const contractType =
    args.parsed.contract_type || (args.parsed.is_contract_like ? "C2C/Contract" : "Full-Time");
  const skillsBrief = args.parsed.skills.join(", ");
  const note = args.notes || args.parsed.notes;
  const callIntro = args.callIntro || "";

  const headerToValue = (header: string): string => {
    const h = normalize(header);
    const map: Record<string, string> = {
      dateapplied: nowISO,
      submissiondate: nowISO,
      createdat: nowISO,
      platformsource: "Portal/JD Paste",
      platformused: "Portal/JD Paste",
      platform: "Portal/JD Paste",
      source: "Portal/JD Paste",
      applicationsource: "Portal/JD Paste",
      companyname: args.parsed.company_or_vendor,
      company: args.parsed.company_or_vendor,
      employer: args.parsed.company_or_vendor,
      organization: args.parsed.company_or_vendor,
      agencycompany: args.parsed.company_or_vendor,
      vendorrecruiter: args.parsed.company_or_vendor,
      vendorname: args.parsed.recruiter_name || args.parsed.company_or_vendor,
      recruiter: args.parsed.recruiter_name,
      recruitername: args.parsed.recruiter_name,
      hiringmanager: args.parsed.recruiter_name,
      contactname: args.parsed.recruiter_name,
      clientname: args.parsed.company_or_vendor,
      endclient: "",
      jobtitle: args.parsed.title,
      title: args.parsed.title,
      role: args.parsed.title,
      positiontitle: args.parsed.title,
      position: args.parsed.title,
      jobidurl: args.parsed.job_id_url,
      joburl: args.parsed.job_id_url,
      postingurl: args.parsed.job_id_url,
      applicationurl: args.parsed.job_id_url,
      joblink: args.parsed.job_id_url,
      location: args.parsed.location,
      remotehybridonsite: args.parsed.remote_mode,
      remotemode: args.parsed.remote_mode,
      contracttype: contractType,
      employmenttype: contractType,
      jobtype: contractType,
      payrate: args.parsed.pay_rate,
      payratesubmitted: args.parsed.pay_rate,
      salaryrange: args.parsed.pay_rate,
      compensation: args.parsed.pay_rate,
      labelstatus: args.status,
      status: args.status,
      stage: args.status,
      pipelinestatus: args.status,
      requirementsbrief: skillsBrief,
      requirements: skillsBrief,
      keyskills: skillsBrief,
      matchedskills: skillsBrief,
      requiredskills: (args.parsed.required_terms || []).join(", "),
      requiredterms: (args.parsed.required_terms || []).join(", "),
      notes: note,
      generalnotes: note,
      jdnotes: note,
      callintro: callIntro,
      quickcallintro: callIntro,
      phoneintro: callIntro,
      shortintro: callIntro,
      elevatorpitch: callIntro,
      vendoremail: args.parsed.vendor_email,
      recruiteremail: args.parsed.vendor_email,
      hiringmanageremail: args.parsed.vendor_email,
      contactemail: args.parsed.vendor_email,
      vendorphone: args.parsed.vendor_phone,
      recruiterphone: args.parsed.vendor_phone,
      hiringmanagerphone: args.parsed.vendor_phone,
      contactphone: args.parsed.vendor_phone,
      fitscore: String(args.parsed.fit_score),
      matchscore: String(args.parsed.fit_score),
      roletrack: args.parsed.role_track,
      resumeoutputpath: args.outputPath || "",
      resumefile: args.outputPath || "",
      companyinemail: "",
      followupdate: "",
      interviewdate: "",
      outcome: "",
      workauthorization: "",
      sponsorship: "",
    };
    return map[h] ?? "";
  };

  const metadata = await withSheetsRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets(properties(title))" })
  );
  const titles = (metadata.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter((x): x is string => Boolean(x));
  const pickTitle = (keyword: string) => titles.find((t) => tabNorm(t).includes(keyword)) || null;
  const targetTabs = [pickTitle("applications"), pickTitle("fulltime"), pickTitle("jobs"), pickTitle("submissions")].filter(
    (x): x is string => Boolean(x)
  );

  if (callIntro) {
    let callTab = pickTitle("callintro") || pickTitle("callnotes") || pickTitle("quickintro");
    if (!callTab) {
      await withSheetsRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: "Call Intros" } } }] },
        })
      );
      callTab = "Call Intros";
    }
    if (!targetTabs.includes(callTab)) targetTabs.push(callTab);
  }
  if (targetTabs.length === 0) targetTabs.push((args.config?.googleSheetTab || appConfig.googleSheetTab).trim());

  for (const tab of targetTabs) {
    const headerResp = await withSheetsRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!2:2` })
    );
    const headers = (headerResp.data.values?.[0] || []).map((x) => String(x).trim());

    if (headers.length === 0) {
      const isCallIntroTab = tabNorm(tab).includes("callintro") || tabNorm(tab).includes("quickintro");
      if (!isCallIntroTab) continue;
      const defaultHeaders = [
        "Date Applied",
        "Company Name",
        "Job Title",
        "Location",
        "Recruiter Name",
        "Recruiter Email",
        "Recruiter Phone",
        "Job URL",
        "Status",
        "JD Notes",
        "Quick Call Intro",
      ];
      await withSheetsRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tab}!A2:K2`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [defaultHeaders] },
        })
      );
      const row = defaultHeaders.map((h) => headerToValue(h));
      await withSheetsRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${tab}!A:K`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] },
        })
      );
      continue;
    }

    const hasCallIntroHeader = headers.some((h) => {
      const key = normalize(h);
      return (
        key === "quickcallintro" ||
        key === "callintro" ||
        key === "phoneintro" ||
        key === "shortintro" ||
        key === "elevatorpitch"
      );
    });
    if (callIntro && !hasCallIntroHeader) {
      headers.push("Quick Call Intro");
      const endCol = columnNumberToLetters(headers.length);
      await withSheetsRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tab}!A2:${endCol}2`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [headers] },
        })
      );
    }

    const row = headers.map((h) => headerToValue(h));
    const dataResp = await withSheetsRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A3:ZZ` })
    );
    const values = dataResp.data.values || [];
    const normalizedHeaders = headers.map((h) => normalize(h));
    const iJobUrl = firstHeaderIndex(normalizedHeaders, [
      "jobidurl",
      "joburl",
      "postingurl",
      "applicationurl",
      "joblink",
    ]);
    const iTitle = firstHeaderIndex(normalizedHeaders, [
      "jobtitle",
      "positiontitle",
      "position",
      "role",
      "title",
    ]);
    const iCompany = firstHeaderIndex(normalizedHeaders, [
      "companyname",
      "company",
      "employer",
      "organization",
      "clientname",
      "agencycompany",
    ]);
    const iRecruiterName = firstHeaderIndex(normalizedHeaders, [
      "recruitername",
      "recruiter",
      "hiringmanager",
      "contactname",
      "vendorname",
      "vendorrecruiter",
    ]);
    const iRecruiterEmail = firstHeaderIndex(normalizedHeaders, [
      "recruiteremail",
      "hiringmanageremail",
      "contactemail",
      "vendoremail",
      "email",
    ]);

    let matchedRowNumber = -1;
    for (let r = 0; r < values.length; r += 1) {
      const rowVals = values[r];
      const jobUrlMatch = iJobUrl >= 0 && args.parsed.job_id_url && textEq(String(rowVals[iJobUrl] || ""), args.parsed.job_id_url);
      if (jobUrlMatch) {
        matchedRowNumber = r + 3;
        break;
      }
      let score = 0;
      if (iTitle >= 0 && args.parsed.title && textEq(String(rowVals[iTitle] || ""), args.parsed.title)) score += 1;
      if (iCompany >= 0 && args.parsed.company_or_vendor && textEq(String(rowVals[iCompany] || ""), args.parsed.company_or_vendor)) score += 1;
      if (
        iRecruiterName >= 0 &&
        (args.parsed.recruiter_name || args.parsed.company_or_vendor) &&
        textEq(String(rowVals[iRecruiterName] || ""), args.parsed.recruiter_name || args.parsed.company_or_vendor)
      )
        score += 1;
      if (
        iRecruiterEmail >= 0 &&
        args.parsed.vendor_email &&
        textEq(String(rowVals[iRecruiterEmail] || ""), args.parsed.vendor_email)
      )
        score += 1;
      if (score >= 3 || (score >= 2 && Boolean(args.parsed.vendor_email))) {
        matchedRowNumber = r + 3;
        break;
      }
    }

    if (matchedRowNumber > 0) {
      await withSheetsRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tab}!A${matchedRowNumber}:ZZ${matchedRowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] },
        })
      );
    } else {
      await withSheetsRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${tab}!A:ZZ`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] },
        })
      );
    }
  }
}
