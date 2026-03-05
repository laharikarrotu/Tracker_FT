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

async function getClient() {
  const env = parseDotEnv(".env.local");
  const sheetId = (env.GOOGLE_SHEET_ID || "").trim();
  let serviceAccountRaw = (env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!sheetId || !serviceAccountRaw) {
    throw new Error("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON in .env.local");
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
  return { sheetId, sheets };
}

async function getSheetMap(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(sheetId,title,index))",
  });
  const map = new Map();
  for (const s of meta.data.sheets || []) {
    if (s.properties?.title && typeof s.properties.sheetId === "number") {
      map.set(s.properties.title, s.properties.sheetId);
    }
  }
  return map;
}

async function main() {
  const { sheetId, sheets } = await getClient();

  const desiredTabs = [
    { title: "📊 Dashboard", color: { red: 0.13, green: 0.35, blue: 0.62 }, index: 0 },
    { title: "📋 Applications", color: { red: 0.16, green: 0.50, blue: 0.73 }, index: 1 },
    { title: "📅 Interviews", color: { red: 0.91, green: 0.60, blue: 0.10 }, index: 2 },
    { title: "🧾 Offers", color: { red: 0.18, green: 0.55, blue: 0.34 }, index: 3 },
    { title: "📁 Archive", color: { red: 0.40, green: 0.40, blue: 0.40 }, index: 4 },
  ];

  let sheetMap = await getSheetMap(sheets, sheetId);

  const addRequests = [];
  for (const tab of desiredTabs) {
    if (!sheetMap.has(tab.title)) {
      addRequests.push({
        addSheet: {
          properties: {
            title: tab.title,
            tabColorStyle: { rgbColor: tab.color },
            index: tab.index,
          },
        },
      });
    }
  }
  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: addRequests },
    });
    sheetMap = await getSheetMap(sheets, sheetId);
  }

  // Delete old/unwanted tabs.
  const desiredTitles = new Set(desiredTabs.map((t) => t.title));
  const deleteRequests = [];
  for (const [title, id] of sheetMap.entries()) {
    if (!desiredTitles.has(title)) {
      deleteRequests.push({ deleteSheet: { sheetId: id } });
    }
  }
  if (deleteRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: deleteRequests },
    });
    sheetMap = await getSheetMap(sheets, sheetId);
  }

  const dashboardId = sheetMap.get("📊 Dashboard");
  const applicationsId = sheetMap.get("📋 Applications");
  const interviewsId = sheetMap.get("📅 Interviews");
  const offersId = sheetMap.get("🧾 Offers");
  const archiveId = sheetMap.get("📁 Archive");

  if (
    dashboardId === undefined ||
    applicationsId === undefined ||
    interviewsId === undefined ||
    offersId === undefined ||
    archiveId === undefined
  ) {
    throw new Error("Expected tabs were not created successfully.");
  }

  // Clear all content on desired tabs.
  for (const tab of desiredTabs) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${tab.title.replace(/'/g, "''")}'!A1:ZZ2000`,
    });
  }

  const applicationHeaders = [
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

  const interviewHeaders = [
    "Date",
    "Company",
    "Role",
    "Round",
    "Interviewer",
    "Interview Type",
    "Scheduled Time",
    "Status",
    "Notes",
    "Next Step",
  ];

  const offerHeaders = [
    "Date",
    "Company",
    "Role",
    "Base Salary",
    "Bonus/Stock",
    "Location",
    "Offer Status",
    "Decision Deadline",
    "Notes",
  ];

  const archiveHeaders = [...applicationHeaders];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "'📊 Dashboard'!A1:E18",
          values: [
            ["JOB SEARCH DASHBOARD - Lahari Karrotu (Full-Time)"],
            [],
            ["Metric", "Value"],
            ["Total Applications", "=COUNTA('📋 Applications'!B3:B)"],
            ["Applied", "=COUNTIF('📋 Applications'!M3:M,\"Applied\")"],
            ["Not Applied Yet", "=COUNTIF('📋 Applications'!M3:M,\"Not Applied Yet\")"],
            ["Interview", "=COUNTIF('📋 Applications'!M3:M,\"Interview\")"],
            ["Offer", "=COUNTIF('📋 Applications'!M3:M,\"Offer\")"],
            ["Rejected/No Response", "=COUNTIF('📋 Applications'!M3:M,\"Rejected/No Response\")"],
            ["Follow-Up Needed", "=COUNTIF('📋 Applications'!M3:M,\"Follow-Up Needed\")"],
            [],
            ["Label Legend", ""],
            ["Applied", ""],
            ["Not Applied Yet", ""],
            ["Interview", ""],
            ["Offer", ""],
            ["Rejected/No Response", ""],
            ["Follow-Up Needed", ""],
          ],
        },
        {
          range: "'📋 Applications'!A1:W2",
          values: [["APPLICATION TRACKER - FULL TIME"], applicationHeaders],
        },
        {
          range: "'📅 Interviews'!A1:J2",
          values: [["INTERVIEW TRACKER"], interviewHeaders],
        },
        {
          range: "'🧾 Offers'!A1:I2",
          values: [["OFFERS TRACKER"], offerHeaders],
        },
        {
          range: "'📁 Archive'!A1:W2",
          values: [["ARCHIVE"], archiveHeaders],
        },
      ],
    },
  });

  const requests = [
    // Unmerge common working ranges first to avoid merge conflicts.
    { unmergeCells: { range: { sheetId: applicationsId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 } } },
    { unmergeCells: { range: { sheetId: interviewsId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 } } },
    { unmergeCells: { range: { sheetId: offersId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 } } },
    { unmergeCells: { range: { sheetId: archiveId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 } } },
    { unmergeCells: { range: { sheetId: dashboardId, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 26 } } },

    // Freeze rows
    { updateSheetProperties: { properties: { sheetId: applicationsId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },
    { updateSheetProperties: { properties: { sheetId: interviewsId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },
    { updateSheetProperties: { properties: { sheetId: offersId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },
    { updateSheetProperties: { properties: { sheetId: archiveId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" } },

    // Merge title rows
    { mergeCells: { range: { sheetId: applicationsId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 23 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId: interviewsId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId: offersId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId: archiveId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 23 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId: dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },

    // Title row style (dark blue)
    {
      repeatCell: {
        range: { sheetId: applicationsId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 23 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.25, blue: 0.45 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 12 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: interviewsId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.25, blue: 0.45 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 12 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: offersId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.25, blue: 0.45 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 12 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: archiveId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 23 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.25, blue: 0.45 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 12 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.25, blue: 0.45 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 13 },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
      },
    },

    // Header row style (light blue)
    {
      repeatCell: {
        range: { sheetId: applicationsId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 23 },
        cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: interviewsId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 10 },
        cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: offersId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: archiveId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 23 },
        cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
      },
    },

    // Dashboard metric header style
    {
      repeatCell: {
        range: { sheetId: dashboardId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 },
        cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
      },
    },

    // Dashboard legend color chips
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.85, green: 0.93, blue: 0.86 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 1, green: 0.95, blue: 0.80 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.88, green: 0.95, blue: 0.88 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.98, green: 0.88, blue: 0.88 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },
    { repeatCell: { range: { sheetId: dashboardId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.99, green: 0.94, blue: 0.86 } } } }, fields: "userEnteredFormat.backgroundColorStyle" } },

    // Alternating row colors for main data regions.
    {
      addBanding: {
        bandedRange: {
          range: { sheetId: applicationsId, startRowIndex: 2, endRowIndex: 1500, startColumnIndex: 0, endColumnIndex: 23 },
          rowProperties: {
            headerColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.98, blue: 1 } },
          },
        },
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: { sheetId: interviewsId, startRowIndex: 2, endRowIndex: 1500, startColumnIndex: 0, endColumnIndex: 10 },
          rowProperties: {
            headerColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.98, blue: 1 } },
          },
        },
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: { sheetId: offersId, startRowIndex: 2, endRowIndex: 1500, startColumnIndex: 0, endColumnIndex: 9 },
          rowProperties: {
            headerColorStyle: { rgbColor: { red: 0.86, green: 0.93, blue: 0.98 } },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.98, blue: 1 } },
          },
        },
      },
    },

    // Status dropdown in Applications column M (index 12).
    {
      setDataValidation: {
        range: { sheetId: applicationsId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 12, endColumnIndex: 13 },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [
              { userEnteredValue: "Applied" },
              { userEnteredValue: "Not Applied Yet" },
              { userEnteredValue: "Follow-Up Needed" },
              { userEnteredValue: "Interview" },
              { userEnteredValue: "Offer" },
              { userEnteredValue: "Rejected/No Response" },
            ],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },

    // Column widths for Applications
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 180 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 220 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 10, endIndex: 11 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 14, endIndex: 16 }, properties: { pixelSize: 220 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: applicationsId, dimension: "COLUMNS", startIndex: 18, endIndex: 20 }, properties: { pixelSize: 240 }, fields: "pixelSize" } },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });

  // Conditional formatting for status colors (M column).
  const statusRules = [
    { text: "Applied", color: { red: 0.85, green: 0.93, blue: 0.86 } },
    { text: "Not Applied Yet", color: { red: 0.96, green: 0.96, blue: 0.96 } },
    { text: "Interview", color: { red: 1, green: 0.95, blue: 0.80 } },
    { text: "Offer", color: { red: 0.88, green: 0.95, blue: 0.88 } },
    { text: "Rejected/No Response", color: { red: 0.98, green: 0.88, blue: 0.88 } },
    { text: "Follow-Up Needed", color: { red: 0.99, green: 0.94, blue: 0.86 } },
  ];

  for (let i = 0; i < statusRules.length; i += 1) {
    const rule = statusRules[i];
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            addConditionalFormatRule: {
              index: i,
              rule: {
                ranges: [{ sheetId: applicationsId, startRowIndex: 2, endRowIndex: 2000, startColumnIndex: 12, endColumnIndex: 13 }],
                booleanRule: {
                  condition: { type: "TEXT_EQ", values: [{ userEnteredValue: rule.text }] },
                  format: { backgroundColorStyle: { rgbColor: rule.color } },
                },
              },
            },
          },
        ],
      },
    });
  }

  console.log("Sheet reset completed.");
  console.log(`Spreadsheet: https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  console.log("Tabs ready: 📊 Dashboard, 📋 Applications, 📅 Interviews, 🧾 Offers, 📁 Archive");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
