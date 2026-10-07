import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { Activity, AlertCircle, Archive, ArchiveRestore, ArrowRight, ArrowUpRight, GitBranch, Layers3, LayoutDashboard, Target } from "lucide-react";
import type { Session, SessionOverview, SessionSummary } from "@aoverview/core/contracts";
import { setSessionArchived, useLiveUpdates, usePages, useResource } from "./data.js";
import { Navigation } from "./components/navigation";
import { AgentAvatar, ErrorNotice, LoadingCards, StatusBadge, StatusIndicator, UpdatedTime } from "./components/overview-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sidebar, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const ActivityCanvas = lazy(() => import("./components/activity").then(module => ({ default: module.ActivityCanvas })));

function selectionFromUrl() {
  const query = new URLSearchParams(window.location.search);
  return { sessionId: query.get("session"), agentId: query.get("agent") };
}

export function App() {
  const [selection, setSelection] = useState(selectionFromUrl);
  const [retry, setRetry] = useState(0);
  const [sessionPages, setSessionPages] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [lastArchived, setLastArchived] = useState<Pick<Session, "id" | "title"> | null>(null);
  const [archiveError, setArchiveError] = useState<{ session: Pick<Session, "id" | "title">; archived: boolean; message: string } | null>(null);
  const live = useLiveUpdates();
  const sessions = usePages<SessionSummary>("/api/v1/sessions", `${live.versions.list}:${retry}`, sessionPages);
  const sessionVersion = `${live.versions.all}:${live.versions.sessions[selection.sessionId ?? ""] ?? 0}:${retry}`;
  const selected = useResource<SessionOverview>(selection.sessionId ? `/api/v1/sessions/${encodeURIComponent(selection.sessionId)}` : null, sessionVersion);
  useEffect(() => {
    const handle = () => setSelection(selectionFromUrl());
    window.addEventListener("popstate", handle);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => { window.removeEventListener("popstate", handle); clearInterval(clock); };
  }, []);

  function navigate(sessionId: string | null, agentId: string | null = null) {
    const url = new URL(window.location.href);
    url.search = ""; url.hash = "";
    if (sessionId) url.searchParams.set("session", sessionId);
    if (agentId) url.searchParams.set("agent", agentId);
    window.history.pushState(null, "", url);
    setSelection({ sessionId, agentId });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function changeArchive(session: Pick<Session, "id" | "title">, archived = true) {
    if (busySessionId) return;
    setBusySessionId(session.id);
    setArchiveError(null);
    try {
      await setSessionArchived(session.id, archived);
      if (archived) sessions.updateData(page => ({ ...page, items: page.items.filter(item => item.id !== session.id) }));
      setLastArchived(archived ? session : null);
      if (selection.sessionId === session.id) navigate(null);
      setRetry(old => old + 1);
    } catch (error) {
      setArchiveError({ session, archived, message: error instanceof Error ? error.message : "Operazione non riuscita. Riprova." });
    } finally { setBusySessionId(null); }
  }

  const list = sessions.data?.items ?? [];
  const overview = selected.data;
  const agent = overview?.agents.find(item => item.id === selection.agentId)
    ?? overview?.agents.find(item => item.id === overview.session.rootAgentId);
  const error = sessions.error ?? selected.error;
  const retryData = () => setRetry(old => old + 1);

  return <SidebarProvider style={{ "--sidebar-width": "16.5rem", "--sidebar-width-icon": "3.5rem" } as CSSProperties}>
    <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Vai al contenuto</a>
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="h-16 justify-center px-4 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2">
          <SidebarBrand home={() => navigate(null)}/>
          <SidebarTrigger aria-label="Apri o chiudi navigazione" className="ml-auto text-muted-foreground group-data-[collapsible=icon]:mx-auto"/>
        </div>
      </SidebarHeader>
      <Navigation sessions={list} sessionId={selection.sessionId} overview={overview} agentId={agent?.id} navigate={navigate}
        archive={session => void changeArchive(session)} archiveDisabled={busySessionId !== null}
        hasMore={Boolean(sessions.data?.nextCursor)} loading={sessions.loading} loadMore={() => setSessionPages(old => old + 1)}/>
    </Sidebar>
    <SidebarInset className={cn(selection.sessionId && "canvas-workspace")}>
      {!selection.sessionId && <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger aria-label="Apri navigazione" className="size-10 shrink-0 md:hidden"/>
          <LayoutDashboard className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true"/>
          <h1 className="truncate text-sm font-medium">Vista d’insieme</h1>
        </div>
        <div role="status" className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", live.connected ? "bg-emerald-400 shadow-[0_0_8px_#34d39940]" : "bg-amber-400")} aria-hidden="true"/>
          {live.connected ? "In diretta" : "Riconnessione…"}
        </div>
      </header>}
      <div id="main" tabIndex={-1} className={cn("outline-none", selection.sessionId
        ? "relative min-h-0 flex-1" : "mx-auto w-full max-w-[1440px] flex-1 space-y-6 p-4 sm:p-6")}>
        {error && <div className={cn(selection.sessionId && "absolute top-28 left-4 z-40 max-w-md right-4 sm:left-6")}><ErrorNotice message={error} retry={retryData}/></div>}
        {archiveError && <div className={cn(selection.sessionId && "absolute top-36 left-4 z-40 max-w-md right-4 sm:left-6")}>
          <ErrorNotice message={archiveError.message} retry={() => void changeArchive(archiveError.session, archiveError.archived)}/>
        </div>}
        {!selection.sessionId ? <>
          {lastArchived && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
            <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
            <span className="min-w-0 flex-1 wrap-anywhere">Sessione archiviata: {lastArchived.title}</span>
            <Button variant="outline" size="sm" disabled={busySessionId !== null} onClick={() => void changeArchive(lastArchived, false)}>
              <ArchiveRestore aria-hidden="true"/>Annulla
            </Button>
          </div>}
          {sessions.data && <SessionMetrics sessions={list} partial={Boolean(sessions.data.nextCursor)}/>}
          <div className="flex items-center justify-between gap-3 pt-1"><h2 className="text-sm font-semibold">Sessioni</h2>
            <span className="text-xs text-muted-foreground">{list.length}</span></div>
          {sessions.loading && !sessions.data && <LoadingCards count={3} label="Caricamento delle sessioni…"/>}
          {!sessions.loading && !sessions.error && list.length === 0 && <EmptyWorkspace/>}
          <div className="grid items-stretch gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {list.map(session => <SessionCard key={session.id} session={session} now={now} open={() => navigate(session.id)}
              archive={() => void changeArchive(session)} archiveDisabled={busySessionId !== null} archiving={busySessionId === session.id}/>)}
          </div>
          {sessions.data?.nextCursor && <div className="flex justify-center"><Button variant="outline" disabled={sessions.loading}
            onClick={() => setSessionPages(old => old + 1)}>{sessions.loading ? "Caricamento…" : "Mostra altre sessioni"}</Button></div>}
        </> : <>
          {selected.loading && !overview && <div className="absolute inset-0 grid place-items-center p-6"><div className="w-full max-w-sm"><LoadingCards count={1} label="Caricamento della sessione…"/></div></div>}
          {!overview && selected.error && <Card className="absolute top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-1/2"><CardContent className="py-8 text-center">
            <h1 className="text-xl font-semibold">Sessione non disponibile</h1>
            <p className="mt-3 text-sm text-muted-foreground">Verifica il collegamento oppure torna alle sessioni.</p>
            <Button variant="outline" className="mt-5" onClick={() => navigate(null)}>Tutte le sessioni<ArrowRight aria-hidden="true"/></Button>
          </CardContent></Card>}
          {overview && agent && <>
            <header className="absolute top-3 left-3 z-20 max-w-[calc(100%-4.5rem)] rounded-xl border bg-background/95 px-3 py-3 shadow-lg backdrop-blur sm:top-5 sm:left-5 sm:px-4 md:max-w-[calc(100%-20rem)]">
              <div className="flex items-start gap-2">
                <SidebarTrigger aria-label="Apri navigazione" className="-ml-1 size-8 shrink-0 md:hidden"/>
                <div className="min-w-0"><h1 className="wrap-anywhere text-sm leading-5 font-semibold tracking-tight sm:text-base">{overview.session.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><AgentAvatar name={agent.name} small/>
                    <span className="min-w-0 wrap-anywhere">{agent.name}</span><StatusBadge status={agent.status}/>
                    {!live.connected && <span role="status" className="text-amber-400">Riconnessione…</span>}
                    {overview.session.archivedAt !== null && <span>Archiviata</span>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto" disabled={busySessionId !== null}
                  aria-label={overview.session.archivedAt !== null ? "Ripristina sessione" : "Archivia sessione"}
                  title={overview.session.archivedAt !== null ? "Ripristina sessione" : "Archivia sessione"}
                  onClick={() => void changeArchive(overview.session, overview.session.archivedAt === null)}>
                  {overview.session.archivedAt !== null ? <ArchiveRestore aria-hidden="true"/> : <Archive aria-hidden="true"/>}
                  <span className="hidden sm:inline">{overview.session.archivedAt !== null ? "Ripristina" : "Archivia"}</span>
                </Button>
              </div>
            </header>
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center p-6"><div className="w-full max-w-sm"><LoadingCards label="Caricamento del canvas…"/></div></div>}>
              <ActivityCanvas key={agent.id} agent={agent} overview={overview} version={sessionVersion} now={now}
                retry={retryData} chooseAgent={id => navigate(overview.session.id, id)}/>
            </Suspense>
          </>}
        </>}
      </div>
    </SidebarInset>
  </SidebarProvider>;
}

function SidebarBrand({ home }: { home: () => void }) {
  const { setOpenMobile } = useSidebar();
  return <Button variant="ghost" onClick={() => { home(); setOpenMobile(false); }} aria-label="AOVerview, tutte le sessioni"
    className="h-auto min-w-0 flex-1 justify-start gap-3 p-1 group-data-[collapsible=icon]:hidden">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted"><Layers3 className="size-4" aria-hidden="true"/></span>
    <span className="text-lg font-semibold tracking-tight">AOVerview</span>
  </Button>;
}

function SessionMetrics({ sessions, partial }: { sessions: SessionSummary[]; partial: boolean }) {
  const running = sessions.reduce((sum, session) => sum + session.workingCount, 0);
  const openGoals = sessions.reduce((sum, session) => sum + session.openGoals, 0);
  const blocked = sessions.reduce((sum, session) => sum + session.blockedCount, 0);
  const metrics = [
    { title: "Agent al lavoro", value: running, icon: Activity },
    { title: "Obiettivi aperti", value: openGoals, icon: Target },
    { title: "Attività bloccate", value: blocked, icon: AlertCircle },
  ];
  return <section aria-label="Riepilogo delle sessioni" className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-3">{metrics.map(metric => <Card key={metric.title} className="gap-3 px-5 py-4">
      <h2 className="flex items-center justify-between gap-3 text-xs text-muted-foreground">{metric.title}<metric.icon className="size-4" aria-hidden="true"/></h2>
      <p className="text-3xl font-semibold tracking-tight">{metric.value}</p>
    </Card>)}</div>
    {partial && <p className="text-xs text-muted-foreground">Conteggi delle {sessions.length} sessioni caricate.</p>}
  </section>;
}

function EmptyWorkspace() {
  return <Card className="getting-started-card border-dashed"><CardContent className="flex flex-col items-center gap-5 py-12 text-center sm:py-20">
    <span className="flex size-14 items-center justify-center rounded-2xl border bg-muted/40"><Layers3 className="size-6 text-muted-foreground" aria-hidden="true"/></span>
    <div><h2 className="text-xl font-semibold tracking-tight">Il prossimo percorso inizia qui.</h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Collega un agent al server MCP e assegnagli la skill AOVerview. La sua prima sessione comparirà automaticamente.</p></div>
    <code className="max-w-full rounded-lg border bg-muted/50 px-4 py-2.5 text-xs break-all">http://localhost:3001/mcp</code>
    <p className="text-xs text-muted-foreground">Gli aggiornamenti descrivono il lavoro a livello macro.</p>
  </CardContent></Card>;
}

function SessionCard({ session, now, open, archive, archiveDisabled, archiving }: {
  session: SessionSummary; now: number; open: () => void; archive: () => void; archiveDisabled: boolean; archiving: boolean;
}) {
  const blocked = session.status === "running" && session.currentBlock?.status === "blocked";
  const status = blocked ? "blocked" : session.status;
  return <div className="group flex h-full flex-col rounded-xl border bg-card transition-colors hover:border-ring/50">
    <button onClick={open} aria-label={`Apri sessione: ${session.title}`}
      className="flex flex-1 flex-col gap-3 rounded-t-xl p-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start gap-2.5"><StatusIndicator status={status} className="mt-1"/>
      <h3 className="min-w-0 flex-1 wrap-anywhere text-sm leading-6 font-semibold">{session.title}</h3>
      <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true"/></div>
    <p className={cn("line-clamp-2 text-sm leading-6", blocked ? "text-amber-300" : "text-muted-foreground")}>
      {blocked ? session.currentBlock?.concern ?? session.currentBlock?.title : session.currentBlock?.title
        ?? (session.status === "completed" ? "Lavoro completato" : session.status === "failed" ? "Esecuzione non riuscita"
          : session.status === "cancelled" ? "Sessione annullata" : "In attesa del prossimo aggiornamento")}
    </p>
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{session.rootAgentName}</span>
      {session.agentCount > 1 && <span className="flex items-center gap-1"><GitBranch className="size-3" aria-hidden="true"/>{session.agentCount - 1} subagent</span>}
      <span className="ml-auto shrink-0" title="Obiettivi completati">{session.completedGoals}/{session.totalGoals} obiettivi</span>
    </div>
    <div className="flex items-center gap-3"><Progress value={session.totalGoals ? session.completedGoals / session.totalGoals * 100 : 0}
      aria-label="Obiettivi completati" className="h-1 flex-1"/>
      <UpdatedTime value={session.updatedAt} now={now}/></div>
    </button>
    <div className="flex justify-end px-3 pb-3"><Button variant="ghost" size="sm" className="text-muted-foreground"
      disabled={archiveDisabled} onClick={archive} aria-label={`Archivia sessione: ${session.title}`}>
      <Archive aria-hidden="true"/>{archiving ? "Archiviazione…" : "Archivia"}
    </Button></div>
  </div>;
}
