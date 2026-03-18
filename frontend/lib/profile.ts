export const CANDIDATE_PROFILE = {
  name: "Lahari Karrotu",
  title: "Software Engineer",
  email: "laharikarrotu24@gmail.com",
  phone: "(321) 234-6914",
  location: "San Francisco, CA",
  linkedin: "linkedin.com/in/lahari-karrotu",
  github: "github.com/laharikarrotu",
  defaultRoleFamily: "Software Engineer",
} as const;

export const CANDIDATE_PROFILE_SKILLS = [
  "python",
  "java",
  "typescript",
  "javascript",
  "sql",
  "fastapi",
  "react",
  "next.js",
  "react native",
  "node.js",
  "aws",
  "gcp",
  "oci",
  "azure",
  "docker",
  "jenkins",
  "github actions",
  "oracle db",
  "postgresql",
  "redis",
  "playwright",
  "langgraph",
  "crewai",
  "langchain",
  "rag pipelines",
  "multi-agent systems",
] as const;

export const CANDIDATE_PROFILE_CONTEXT = `
Headline:
Lahari Karrotu — Software Engineer in San Francisco, CA.

Contact:
- Email: laharikarrotu24@gmail.com
- Phone: (321) 234-6914
- LinkedIn: linkedin.com/in/lahari-karrotu
- GitHub: github.com/laharikarrotu

Summary:
Software Engineer building AI agent systems, backend APIs, and scalable full-stack applications.
Experience across enterprise and startup environments with Python, Java, TypeScript, AWS, GCP, and OCI.

Recent experience highlights:
- Oracle (May 2025-Present): production Java REST APIs on OCI, SQL optimization, automation with Python, CI/CD quality gates.
- Anguliyam (Jun 2024-Apr 2025): multi-agent orchestration, enterprise RAG pipelines, HITL governance, external tool integrations.
- Adobe intern: React/TypeScript frontend engineering and testing.
- EPAM intern: Python/Java ETL, SQL, delivery in Agile teams.

Projects:
- HealthScan (agentic healthcare assistant)
- Blinds & Boundaries (AI virtual try-on platform)
- AI Resume Tailor (Next.js + Claude + Google Sheets)
- SmartBuy v2 (multimodal shopping agent)
`.trim();

export function signatureBlock(): string {
  return [
    "Thanks,",
    CANDIDATE_PROFILE.name,
    CANDIDATE_PROFILE.title,
    CANDIDATE_PROFILE.location,
    CANDIDATE_PROFILE.email,
    CANDIDATE_PROFILE.phone,
    CANDIDATE_PROFILE.linkedin,
    CANDIDATE_PROFILE.github,
  ].join("\n");
}
