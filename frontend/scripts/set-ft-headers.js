const fs = require("fs");
const { google } = require("googleapis");

function parseDotEnv(filePath) {
  const envText = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return env;
}

async function main() {
  const env = parseDotEnv(".env.local");
  const sheetId = (env.GOOGLE_SHEET_ID || "").trim();
  let serviceAccountRaw = (env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!sheetId || !serviceAccountRaw) {
    throw new Error("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON in frontend/.env.local");
  }

  if (!serviceAccountRaw.startsWith("{")) {
    serviceAccountRaw = Buffer.from(serviceAccountRaw, "base64").toString("utf8");
  }
  const credentials = JSON.parse(serviceAccountRaw);
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(title))",
  });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter((x) => Boolean(x));
  const tab = titles.find((t) => String(t).toLowerCase().includes("applications")) || titles[0];
  if (!tab) throw new Error("No tabs found in the target spreadsheet.");

  const headers = [
    "Date Applied",
    "Company Name",
    "Job Title",
    "Location",
    "Remote Mode",
    "Employment Type",
    "Compensation",
    "Recruiter Name",
    "Recruiter Email",
    "Recruiter Phone",
    "Job URL",
    "Source",
    "Status",
    "Stage",
    "Key Skills",
    "Required Skills",
    "Fit Score",
    "Resume Output Path",
    "JD Notes",
    "Quick Call Intro",
    "Follow-up Date",
    "Interview Date",
    "Outcome",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!A2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });

  console.log(`Updated full-time headers in tab: ${tab}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
