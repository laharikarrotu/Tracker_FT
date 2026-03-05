function envBool(name: string, defaultValue: boolean): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(value);
}

export const appConfig = {
  anthropicExtractionModel: (process.env.ANTHROPIC_EXTRACTION_MODEL ?? "").trim(),
  anthropicTailorModel: (process.env.ANTHROPIC_TAILOR_MODEL ?? "").trim(),
  anthropicEmailModel: (process.env.ANTHROPIC_EMAIL_MODEL ?? "").trim(),
  claudeExtractionEnabled: envBool("CLAUDE_EXTRACTION_ENABLED", true),
  claudeExtractionOnly: envBool("CLAUDE_EXTRACTION_ONLY", true),
  googleSheetTab: (process.env.GOOGLE_SHEET_TAB ?? "Applications").trim(),
  baseResumeDocxBase64: (process.env.BASE_RESUME_DOCX_BASE64 ?? "").trim(),
};
