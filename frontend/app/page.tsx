"use client";

import { FormEvent, useState } from "react";

type ParsedJD = {
  title: string;
  company_or_vendor: string;
  location: string;
  contract_type: string;
  skills: string[];
  fit_score?: number;
  is_contract_like?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function HomePage() {
  const [jobDescription, setJobDescription] = useState("");
  const [replacementMode, setReplacementMode] = useState("minimal");
  const [status, setStatus] = useState("Ready");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [resumePath, setResumePath] = useState("");
  const [parsed, setParsed] = useState<ParsedJD | null>(null);
  const [isBusy, setIsBusy] = useState(false);

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
    try {
      setIsBusy(true);
      const payload = await postJSON<{
        parsed: ParsedJD;
        output_path: string;
        sheet_status: string;
      }>("/api/tailor-resume", {
        ...apiPayload,
        replacement_mode: replacementMode
      });
      setParsed(payload.parsed);
      setResumePath(payload.output_path);
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
              <li><strong>Location:</strong> {parsed.location}</li>
              <li><strong>Contract Type:</strong> {parsed.contract_type || "Not specified"}</li>
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
        API base URL: <code>{API_BASE}</code>. Set <code>NEXT_PUBLIC_API_BASE_URL</code> on Vercel.
      </p>
    </main>
  );
}
