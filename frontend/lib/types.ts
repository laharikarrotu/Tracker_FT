export type JDRequestBody = {
  job_description: string;
  anthropic_api_key?: string;
  target_role_mode?: "auto" | "backend" | "full-stack" | "ai-agent";
  strict_template_lock?: boolean;
  override_title?: string;
  override_company?: string;
  override_location?: string;
  override_contract?: string;
  template_docx_base64?: string;
  template_file_name?: string;
  google_sheet_id?: string;
  google_sheet_tab?: string;
  google_service_account_json?: string;
};

export type ParsedJD = {
  raw_jd: string;
  title: string;
  company_or_vendor: string;
  recruiter_name: string;
  hiring_manager: string;
  team: string;
  seniority: string;
  vendor_email: string;
  vendor_phone: string;
  visa_sponsorship: string;
  location: string;
  contract_type: string;
  remote_mode: string;
  pay_rate: string;
  job_id_url: string;
  skills: string[];
  role_track: string;
  required_terms: string[];
  must_have_terms: string[];
  nice_to_have_terms: string[];
  keyword_source: "claude" | "rule-based";
  notes: string;
  is_contract_like: boolean;
  fit_score: number;
};

export type ClaudeExtraction = {
  title?: string;
  company_or_vendor?: string;
  recruiter_name?: string;
  hiring_manager?: string;
  team?: string;
  seniority?: string;
  vendor_email?: string;
  vendor_phone?: string;
  visa_sponsorship?: string;
  location?: string;
  contract_type?: string;
  remote_mode?: string;
  pay_rate?: string;
  job_id_url?: string;
  skills?: string[];
  role_track?: string;
  required_terms?: string[];
  must_have_terms?: string[];
  nice_to_have_terms?: string[];
};

export type TailoredContent = {
  summary_points: string[];
  experience_points: string[];
  skills_line: string;
  tailored_for_role: string;
  contract_alignment_note: string;
};

export type TemplateBulletCounts = {
  summaryCount: number;
  experienceCount: number;
};

export type ATSAnalysis = {
  required_terms: string[];
  covered_terms: string[];
  missing_terms: string[];
  coverage_ratio: number;
};

export type FitScoreBreakdown = {
  target_role_mode: "auto" | "backend" | "full-stack" | "ai-agent";
  baseline_fit_score: number;
  tailored_fit_score: number;
  completeness_ratio: number;
  coverage_before_ratio: number;
  coverage_after_ratio: number;
  required_terms: string[];
  covered_before_terms: string[];
  covered_after_terms: string[];
  missing_before_terms: string[];
  missing_after_terms: string[];
};
