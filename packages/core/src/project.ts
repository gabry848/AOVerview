/** Preserve a readable name while treating common spelling variants as one project. */
export function projectName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function projectKey(value: string): string {
  return projectName(value).normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[\s\p{Dash_Punctuation}_]/gu, "");
}
