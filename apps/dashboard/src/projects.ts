import type { SessionSummary } from "@aoverview/core/contracts";

export function groupSessionsByProject(sessions: SessionSummary[]) {
  const groups = new Map<string | null, { key: string | null; name: string; sessions: SessionSummary[] }>();
  for (const session of sessions) {
    const key = session.projectKey ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: session.project ?? "Senza progetto", sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  // Keep projects in the order of their most recent session; unassigned work goes last.
  return [...groups.values()].filter(group => group.key !== null)
    .concat(groups.get(null) ? [groups.get(null)!] : []);
}
