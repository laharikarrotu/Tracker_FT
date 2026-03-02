"use client";

import { FormEvent, useState } from "react";

type ParsedJD = {
  title: string;
  company_or_vendor: string;
  recruiter_name?: string;
  vendor_email?: string;
  location: string;
  contract_type: string;
  remote_mode?: string;
  pay_rate?: string;
  job_id_url?: string;
  skills: string[];
  fit_score?: number;
  is_contract_like?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export default function HomePage() {
  const [jobDescription, setJobDescription] = useState("");
  const [replacementMode, setReplacementMode] = useState("minimal");
  const [status, setStatus] = useState("Ready");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [resumePath, setResumePath] = useState("");
  const [parsed, setParsed] = useState<ParsedJD | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [templateFileName, setTemplateFileName] = useState("");
  const [templateBase64, setTemplateBase64] = useState("");

  const apiPayload = {
    job_description: jobDescription,
    override_title: "",
    override_company: "",
    override_location: "",
    override_contract: ""
  };

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
        apiPayload
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
    if (!templateBase64) {
      setStatus("Upload your base resume DOCX first.");
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
        };
        output_path: string;
        docx_base64: string;
        file_name: string;
        sheet_status: string;
      }>("/api/tailor-resume", {
        ...apiPayload,
        replacement_mode: replacementMode,
        template_docx_base64: templateBase64,
        template_file_name: templateFileName || "Mehar_Lahari_Resume_DE.docx"
      });
      setParsed(payload.parsed);
      setResumePath(payload.output_path);
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
      const payload = await postJSON<{ email_template: string }>("/api/generate-email", apiPayload);
      setEmailTemplate(payload.email_template);
      setStatus("Email template generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Email generation failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="container">
      <h1>Resume Tailor Frontend</h1>
      <p className="sub">Paste JD once, then parse, tailor, and generate email.</p>

      <form onSubmit={onParseAndLog} className="panel">
        <label htmlFor="jd">Job Description</label>
        <textarea
          id="jd"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste LinkedIn, email, or portal JD here..."
          rows={14}
        />

        <div className="row">
          <label htmlFor="resume-template">Resume Template (.docx)</label>
          <input
            id="resume-template"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setTemplateFileName(file.name);
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result || "");
                const base64 = result.includes(",") ? result.split(",")[1] : result;
                setTemplateBase64(base64);
              };
              reader.readAsDataURL(file);
            }}
          />
        </div>

        <div className="row">
          <label htmlFor="mode">Replacement Mode</label>
          <select id="mode" value={replacementMode} onChange={(e) => setReplacementMode(e.target.value)}>
            <option value="minimal">Minimal (1 summary + 2 bullets)</option>
            <option value="balanced">Balanced (2 summary + 6 bullets)</option>
            <option value="aggressive">Aggressive (full replacement)</option>
          </select>
        </div>

        <div className="actions">
          <button type="submit">Parse and Log JD</button>
          <button type="button" onClick={onTailorResume} disabled={isBusy}>
            Tailor Resume
          </button>
          <button type="button" onClick={onGenerateEmail} disabled={isBusy}>
            Generate Email
          </button>
        </div>
      </form>

      <section className="grid">
        <div className="panel">
          <h2>Extracted Details</h2>
          {parsed ? (
            <ul>
              <li><strong>Title:</strong> {parsed.title}</li>
              <li><strong>Company/Vendor:</strong> {parsed.company_or_vendor || "Not specified"}</li>
              <li><strong>Recruiter Name:</strong> {parsed.recruiter_name || "Not specified"}</li>
              <li><strong>Vendor Email:</strong> {parsed.vendor_email || "Not specified"}</li>
              <li><strong>Location:</strong> {parsed.location}</li>
              <li><strong>Work Mode:</strong> {parsed.remote_mode || "Not specified"}</li>
              <li><strong>Contract Type:</strong> {parsed.contract_type || "Not specified"}</li>
              <li><strong>Pay Rate:</strong> {parsed.pay_rate || "Not specified"}</li>
              <li><strong>Job URL/ID:</strong> {parsed.job_id_url || "Not specified"}</li>
              <li><strong>Skills:</strong> {parsed.skills.join(", ") || "No skills detected yet"}</li>
              <li><strong>Fit Score:</strong> {parsed.fit_score ?? "N/A"}</li>
              <li><strong>Contract-like:</strong> {String(parsed.is_contract_like ?? false)}</li>
            </ul>
          ) : (
            <p>Click "Parse and Log JD" to see extracted fields.</p>
          )}
        </div>

        <div className="panel">
          <h2>Outputs</h2>
          <p><strong>Status:</strong> {status}</p>
          <p><strong>Resume Output:</strong> {resumePath || "Not generated yet"}</p>
          <label htmlFor="email-template">Submission Email Template</label>
          <textarea id="email-template" value={emailTemplate} readOnly rows={12} />
        </div>
      </section>

      <p className="foot">
        API base URL: <code>{API_BASE || "same-origin"}</code>. Leave unset for Vercel-only mode.
      </p>
    </main>
  );
}
