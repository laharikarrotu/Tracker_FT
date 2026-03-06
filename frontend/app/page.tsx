"use client";

import { FormEvent, useState } from "react";

type ParsedJD = {
  title: string;
  company_or_vendor: string;
  recruiter_name?: string;
  vendor_email?: string;
  vendor_phone?: string;
  location: string;
  contract_type: string;
  remote_mode?: string;
  pay_rate?: string;
  job_id_url?: string;
  skills: string[];
  role_track?: string;
  required_terms?: string[];
  fit_score?: number;
  is_contract_like?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export default function HomePage() {
  const [jobDescription, setJobDescription] = useState("");
  const [status, setStatus] = useState("Ready");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [callIntro, setCallIntro] = useState("");
  const [resumePath, setResumePath] = useState("");
  const [tailoredFitScore, setTailoredFitScore] = useState<number | null>(null);
  const [parsed, setParsed] = useState<ParsedJD | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [templateDocxBase64, setTemplateDocxBase64] = useState("");
  const [templateFileName, setTemplateFileName] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetTab, setSheetTab] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");

  const apiPayload = () => ({
    job_description: jobDescription,
    anthropic_api_key: anthropicApiKey || undefined,
    override_title: "",
    override_company: "",
    override_location: "",
    override_contract: "",
    template_docx_base64: templateDocxBase64 || undefined,
    template_file_name: templateFileName || undefined,
    google_sheet_id: sheetId || undefined,
    google_sheet_tab: sheetTab || undefined,
    google_service_account_json: serviceAccountJson || undefined,
  });

  async function postJSON<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail || "Request failed.");
    }
    return payload as T;
  }

  async function fileToBase64(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  const onResumeTemplateChange = async (file?: File) => {
    if (!file) {
      setTemplateDocxBase64("");
      setTemplateFileName("");
      return;
    }
    const base64 = await fileToBase64(file);
    setTemplateDocxBase64(base64);
    setTemplateFileName(file.name);
  };

  const onServiceAccountJsonChange = async (file?: File) => {
    if (!file) {
      setServiceAccountJson("");
      return;
    }
    const text = await file.text();
    setServiceAccountJson(text);
  };

  const onParseAndLog = async (e: FormEvent) => {
    e.preventDefault();
    if (!jobDescription.trim()) {
      setStatus("Paste a JD first.");
      return;
    }
    try {
      setIsBusy(true);
      const payload = await postJSON<{ parsed: ParsedJD; sheet_status: string }>(
        "/api/parse-and-log",
        apiPayload()
      );
      setParsed(payload.parsed);
      setStatus(payload.sheet_status);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Parse request failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const onTailorResume = async () => {
    if (!jobDescription.trim()) {
      setStatus("Paste a JD first.");
      return;
    }
    try {
      setIsBusy(true);
      const payload = await postJSON<{
        parsed: ParsedJD;
        tailored: {
          summary_points: string[];
          experience_points: string[];
          skills_line: string;
          contract_alignment_note: string;
          tailored_fit_score: number;
        };
        output_path: string;
        docx_base64: string;
        file_name: string;
        sheet_status: string;
      }>("/api/tailor-resume", {
        ...apiPayload()
      });
      setParsed(payload.parsed);
      setResumePath(payload.output_path);
      setTailoredFitScore(payload.tailored.tailored_fit_score);
      if (payload.docx_base64) {
        const bytes = Uint8Array.from(atob(payload.docx_base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = payload.file_name || "tailored-resume.docx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setStatus(`Resume generated. ${payload.sheet_status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Tailor request failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const onGenerateEmail = async () => {
    if (!jobDescription.trim()) {
      setStatus("Paste a JD first.");
      return;
    }
    try {
      setIsBusy(true);
      const payload = await postJSON<{ email_template: string }>("/api/generate-email", apiPayload());
      setEmailTemplate(payload.email_template);
      setStatus("Email template generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Email generation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const onGenerateCoverLetter = async () => {
    if (!jobDescription.trim()) {
      setStatus("Paste a JD first.");
      return;
    }
    try {
      setIsBusy(true);
      const payload = await postJSON<{ cover_letter: string }>("/api/generate-cover-letter", apiPayload());
      setCoverLetter(payload.cover_letter);
      setStatus("Cover letter generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cover letter generation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const onGenerateCallIntro = async () => {
    if (!jobDescription.trim()) {
      setStatus("Paste a JD first.");
      return;
    }
    try {
      setIsBusy(true);
      const payload = await postJSON<{ call_intro: string; sheet_status?: string }>(
        "/api/generate-call-intro",
        apiPayload()
      );
      setCallIntro(payload.call_intro);
      setStatus(payload.sheet_status || "My call self-intro generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Call intro generation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="container">
      <h1>✨ AI Resume Tailoring and Job Tracking</h1>
      <p className="sub">Paste JD once, then parse/log, tailor resume, and generate outreach content.</p>

      <form onSubmit={onParseAndLog} className="panel">
        <label htmlFor="jd">Job Description</label>
        <textarea
          id="jd"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste LinkedIn, email, or portal JD here..."
          rows={14}
        />

        <details className="row">
          <summary>Advanced overrides (optional)</summary>

          <label htmlFor="resume-template">Resume Template (.docx, optional)</label>
          <input
            id="resume-template"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={async (e) => {
              setStatus("Reading resume template...");
              try {
                await onResumeTemplateChange(e.target.files?.[0]);
                setStatus("Resume template ready.");
              } catch {
                setStatus("Failed to read resume template.");
              }
            }}
          />

          <label htmlFor="anthropic-api-key">Claude API Key (optional override)</label>
          <input
            id="anthropic-api-key"
            type="password"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            placeholder="Leave empty to use server ANTHROPIC_API_KEY"
            autoComplete="off"
          />

          <label htmlFor="sheet-id">Google Sheet ID (optional override)</label>
          <input
            id="sheet-id"
            type="text"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            placeholder="Leave empty to use GOOGLE_SHEET_ID env"
          />

          <label htmlFor="sheet-tab">Google Sheet Tab (optional override)</label>
          <input
            id="sheet-tab"
            type="text"
            value={sheetTab}
            onChange={(e) => setSheetTab(e.target.value)}
            placeholder="Leave empty to use detected tabs/default env tab"
          />

          <label htmlFor="service-json-file">Service Account JSON File (optional override)</label>
          <input
            id="service-json-file"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              setStatus("Reading service account JSON...");
              try {
                await onServiceAccountJsonChange(e.target.files?.[0]);
                setStatus("Service account JSON ready.");
              } catch {
                setStatus("Failed to read service account JSON.");
              }
            }}
          />

          <div className="row">
            <small>
              Leave all fields empty to use default server env vars. Use overrides only for temporary testing.
            </small>
          </div>
        </details>

        <div className="actions">
          <button type="submit">Parse and Log JD</button>
          <button type="button" onClick={onTailorResume} disabled={isBusy}>
            Tailor Resume
          </button>
          <button type="button" onClick={onGenerateEmail} disabled={isBusy}>
            Generate Email
          </button>
          <button type="button" onClick={onGenerateCoverLetter} disabled={isBusy}>
            Generate Cover Letter
          </button>
          <button type="button" onClick={onGenerateCallIntro} disabled={isBusy}>
            Generate My Intro
          </button>
        </div>
      </form>

      <section className="grid">
        <div className="panel">
          <h2>🔎 Extracted Details</h2>
          {parsed ? (
            <ul>
              <li><strong>Title:</strong> {parsed.title}</li>
              <li><strong>company/vendor:</strong> {parsed.company_or_vendor || "Not specified"}</li>
              <li><strong>recruiter_name:</strong> {parsed.recruiter_name || "Not specified"}</li>
              <li><strong>vendor_email:</strong> {parsed.vendor_email || "Not specified"}</li>
              <li><strong>vendor_phone:</strong> {parsed.vendor_phone || "Not specified"}</li>
              <li><strong>location:</strong> {parsed.location || "Not specified"}</li>
              <li><strong>remote_mode:</strong> {parsed.remote_mode || "Not specified"}</li>
              <li><strong>contract_type:</strong> {parsed.contract_type || "Not specified"}</li>
              <li><strong>pay_rate:</strong> {parsed.pay_rate || "Not specified"}</li>
              <li><strong>job_id_url:</strong> {parsed.job_id_url || "Not specified"}</li>
              <li><strong>skills[]:</strong> {parsed.skills.join(", ") || "No skills detected yet"}</li>
              <li><strong>role_track:</strong> {parsed.role_track || "general"}</li>
              <li><strong>required_terms[]:</strong> {(parsed.required_terms || []).join(", ") || "Not detected"}</li>
              <li><strong>fit_score:</strong> {parsed.fit_score ?? "N/A"}</li>
              <li><strong>is_contract_like:</strong> {String(parsed.is_contract_like ?? false)}</li>
            </ul>
          ) : (
            <p>Click "Parse and Log JD" to see extracted fields.</p>
          )}
        </div>

        <div className="panel">
          <h2>🪄 Outputs</h2>
          <p><strong>Status:</strong> {status}</p>
          <p><strong>Resume Output:</strong> {resumePath || "Not generated yet"}</p>
          <p><strong>Tailored Fit Score:</strong> {tailoredFitScore ?? "Not generated yet"}</p>
          <label htmlFor="email-template">Submission Email Template</label>
          <textarea id="email-template" value={emailTemplate} readOnly rows={12} />
          <label htmlFor="cover-letter">Cover Letter</label>
          <textarea id="cover-letter" value={coverLetter} readOnly rows={16} />
          <label htmlFor="call-intro">My Call Self-Intro (4-5 lines)</label>
          <textarea id="call-intro" value={callIntro} readOnly rows={6} />
        </div>
      </section>

      <p className="foot">
        API base URL: <code>{API_BASE || "same-origin"}</code>. Leave unset for Vercel-only mode.
      </p>
    </main>
  );
}
