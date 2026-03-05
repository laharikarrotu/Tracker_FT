export const CANDIDATE_PROFILE = {
  name: "Mehar Lahari",
  title: "Senior Data Engineer",
  email: "meharlahari@gmail.com",
  phone: "+1 601-460-9527",
  defaultRoleFamily: "Data Engineer",
} as const;

export function signatureBlock(): string {
  return [
    "Thanks,",
    CANDIDATE_PROFILE.name,
    CANDIDATE_PROFILE.title,
    CANDIDATE_PROFILE.email,
    CANDIDATE_PROFILE.phone,
  ].join("\n");
}
