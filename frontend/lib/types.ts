export type JDRequestBody = {
  job_description: string;
  anthropic_api_key?: string;
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
  vendor_email: string;
  vendor_phone: string;
  location: string;
  contract_type: string;
  remote_mode: string;
  pay_rate: string;
  job_id_url: string;
  skills: string[];
  role_track: string;
  required_terms: string[];
  notes: string;
  is_contract_like: boolean;
  fit_score: number;
};

export type ClaudeExtraction = {
  title?: string;
  company_or_vendor?: string;
  recruiter_name?: string;
  vendor_email?: string;
  vendor_phone?: string;
  location?: string;
  contract_type?: string;
  remote_mode?: string;
  pay_rate?: string;
  job_id_url?: string;
  skills?: string[];
  role_track?: string;
  required_terms?: string[];
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
