import JSZip from "jszip";
import { safeText } from "@/lib/common";
import type { TailoredContent, TemplateBulletCounts } from "@/lib/types";

type DocxOptions = {
  maxSummaryReplacements: number;
  maxExperienceReplacements: number;
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export async function extractDocxPlainText(docxBase64: string): Promise<string> {
  const cleaned = docxBase64.replace(/^data:.*;base64,/, "");
  const zip = await JSZip.loadAsync(Buffer.from(cleaned, "base64"));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Invalid DOCX: word/document.xml not found.");

  const xml = await file.async("text");
  const text = Array.from(xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((m) => decodeXmlEntities(m[1]))
    .join(" ");
  return safeText(text).replace(/\s+/g, " ").trim();
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
  const first = paragraphXml.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/, `<w:t$1>${xmlEscape(newText)}</w:t>`);
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
      const line = safeText(tailored.summary_points[i] || "");
      if (!line) continue;
      replacements.set(idx, replaceParagraphTextPreserveRuns(paragraphs[idx], line));
    }
  }

  if (experienceHeader >= 0 && expEnd > experienceHeader) {
    const expBullets: number[] = [];
    for (let i = experienceHeader + 1; i < expEnd; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (txt && isBulletParagraph(paragraphs[i], txt)) expBullets.push(i);
    }
    const count = Math.min(options.maxExperienceReplacements, expBullets.length, tailored.experience_points.length);
    for (let i = 0; i < count; i += 1) {
      const idx = expBullets[i];
      const line = safeText(tailored.experience_points[i] || "");
      if (!line) continue;
      replacements.set(idx, replaceParagraphTextPreserveRuns(paragraphs[idx], line));
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

export async function getTemplateBulletCounts(templateDocxBase64: string): Promise<TemplateBulletCounts> {
  const cleaned = templateDocxBase64.replace(/^data:.*;base64,/, "");
  const zip = await JSZip.loadAsync(Buffer.from(cleaned, "base64"));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Invalid DOCX template: word/document.xml not found.");

  const xml = await file.async("text");
  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
  const paragraphs = Array.from(xml.matchAll(paragraphRegex)).map((m) => m[0]);
  if (paragraphs.length === 0) throw new Error("Invalid DOCX template: no paragraphs found.");

  const summaryHeader = findHeaderIndex(paragraphs, ["summary", "professional summary", "profile"]);
  const experienceHeader = findHeaderIndex(paragraphs, ["experience", "professional experience", "work experience"]);
  const skillsHeader = findHeaderIndex(paragraphs, ["skills", "technical skills", "core skills"]);

  const summaryEnd = [experienceHeader, skillsHeader, paragraphs.length].filter((x) => x > summaryHeader).sort((a, b) => a - b)[0];
  const expEnd = [skillsHeader, paragraphs.length].filter((x) => x > experienceHeader).sort((a, b) => a - b)[0];

  let summaryCount = 0;
  if (summaryHeader >= 0 && summaryEnd > summaryHeader) {
    for (let i = summaryHeader + 1; i < summaryEnd; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (txt && isBulletParagraph(paragraphs[i], txt)) summaryCount += 1;
    }
  }

  let experienceCount = 0;
  if (experienceHeader >= 0 && expEnd > experienceHeader) {
    for (let i = experienceHeader + 1; i < expEnd; i += 1) {
      const txt = paragraphText(paragraphs[i]);
      if (txt && isBulletParagraph(paragraphs[i], txt)) experienceCount += 1;
    }
  }

  return {
    summaryCount: Math.max(summaryCount, 1),
    experienceCount: Math.max(experienceCount, 1),
  };
}
