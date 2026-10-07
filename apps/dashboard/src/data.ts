import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, Page, Session } from "@aoverview/core/contracts";

export async function setSessionArchived(sessionId: string, archived: boolean): Promise<Session> {
  const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/archive`, {
    method: archived ? "POST" : "DELETE", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(response.status === 404 ? "Questa sessione non è disponibile."
    : archived ? "Impossibile archiviare la sessione. Riprova." : "Impossibile ripristinare la sessione. Riprova.");
  return response.json() as Promise<Session>;
}

export async function readApi<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 404 ? "Questa attività non è disponibile." : "Impossibile aggiornare i dati. Controlla che i servizi siano avviati.");
  return response.json() as Promise<T>;
}

interface Resource<T> { url: string | null; data: T | null; error: string | null; loading: boolean }

export function useResource<T>(url: string | null, version: string | number) {
  const [resource, setResource] = useState<Resource<T>>({ url: null, data: null, error: null, loading: false });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setResource(old => ({ url, data: old.url === url ? old.data : null, error: null, loading: true }));
    void readApi<T>(url, controller.signal).then(data => {
      if (!controller.signal.aborted) setResource({ url, data, error: null, loading: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResource(old => ({ ...old, loading: false, error: error instanceof Error ? error.message : "Dati non disponibili." }));
    });
    return () => controller.abort();
  }, [url, version]);
  return resource.url === url ? resource : { url, data: null, error: null, loading: url !== null };
}

export function usePages<T>(url: string | null, version: string | number, pages: number) {
  const [resource, setResource] = useState<Resource<Page<T>>>({ url: null, data: null, error: null, loading: false });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setResource(old => ({ url, data: old.url === url ? old.data : null, error: null, loading: true }));
    void (async () => {
      const items: T[] = [];
      let cursor: string | null = null;
      for (let index = 0; index < pages; index++) {
        const target = new URL(url, window.location.origin);
        target.searchParams.set("limit", "30");
        if (cursor !== null) target.searchParams.set("cursor", cursor);
        const result = await readApi<Page<T>>(`${target.pathname}${target.search}`, controller.signal);
        items.push(...result.items); cursor = result.nextCursor;
        if (cursor === null) break;
      }
      if (!controller.signal.aborted) setResource({ url, data: { items, nextCursor: cursor }, error: null, loading: false });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setResource(old => ({ ...old, loading: false, error: error instanceof Error ? error.message : "Dati non disponibili." }));
    });
    return () => controller.abort();
  }, [url, version, pages]);
  const visible = resource.url === url ? resource : { url, data: null, error: null, loading: url !== null };
  return { ...visible, updateData: (update: (data: Page<T>) => Page<T>) => {
    setResource(old => old.url === url && old.data ? { ...old, data: update(old.data) } : old);
  } };
}

export function useLiveUpdates() {
  const [connected, setConnected] = useState(false);
  const [versions, setVersions] = useState({ list: 0, all: 0, sessions: {} as Record<string, number> });
  const pending = useRef(new Set<string>());
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshAll = () => {
      setConnected(true);
      setVersions(old => ({ ...old, list: old.list + 1, all: old.all + 1 }));
    };
    events.addEventListener("ready", refreshAll);
    events.addEventListener("reset", refreshAll);
    events.addEventListener("change", event => {
      const change = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
      pending.current.add(change.sessionId);
      if (timer) return;
      timer = setTimeout(() => {
        const ids = [...pending.current]; pending.current.clear(); timer = undefined;
        setVersions(old => {
          const sessions = { ...old.sessions };
          for (const id of ids) sessions[id] = (sessions[id] ?? 0) + 1;
          return { ...old, list: old.list + 1, sessions };
        });
      }, 150);
    });
    events.onerror = () => setConnected(false);
    return () => { events.close(); if (timer) clearTimeout(timer); pending.current.clear(); };
  }, []);
  return { connected, versions };
}
