import { useEffect, useState, type CSSProperties } from "react";
import { Activity, ArrowRight, ArrowUpRight, Clock3, GitBranch, Layers3, LayoutDashboard, Target } from "lucide-react";
import type { SessionOverview, SessionSummary } from "@aoverview/core/contracts";
import { useLiveUpdates, usePages, useResource } from "./data.js";
import { Timeline } from "./components/activity";
import { Goals } from "./components/goals";
import { Navigation } from "./components/navigation";
import { AgentAvatar, ErrorNotice, LoadingCards, StatusBadge, UpdatedTime, ago } from "./components/overview-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function selectionFromUrl() {
  const query = new URLSearchParams(window.location.search);
  return { sessionId: query.get("session"), agentId: query.get("agent") };
}

export function App() {
  const [selection, setSelection] = useState(selectionFromUrl);
  const [retry, setRetry] = useState(0);
  const [sessionPages, setSessionPages] = useState(1);
  const [now, setNow] = useState(Date.now());
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
        hasMore={Boolean(sessions.data?.nextCursor)} loading={sessions.loading} loadMore={() => setSessionPages(old => old + 1)}/>
    </Sidebar>
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger aria-label="Apri navigazione" className="size-10 shrink-0 md:hidden"/>
          <LayoutDashboard className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true"/>
          <h2 className="truncate text-sm font-medium">{selection.sessionId ? "Attività della sessione" : "Vista d’insieme"}</h2>
        </div>
        <div role="status" className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", live.connected ? "bg-emerald-400 shadow-[0_0_8px_#34d39940]" : "bg-amber-400")} aria-hidden="true"/>
          {live.connected ? "In diretta" : "Riconnessione…"}
        </div>
      </header>
      <div id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 p-4 outline-none sm:p-6">
        {error && <ErrorNotice message={error} retry={retryData}/>}
        {!selection.sessionId ? <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="mb-2 text-xs font-medium text-muted-foreground">WORKSPACE</p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Il lavoro degli agent.</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Obiettivi, progressi e prossimi passi. Tutto a colpo d’occhio.</p></div>
            <Badge variant="outline" className="gap-1.5 py-1.5 text-xs text-muted-foreground"><Clock3 className="size-3" aria-hidden="true"/>Aggiornamento automatico</Badge>
          </div>
          {list.length > 0 && <SessionMetrics sessions={list}/>}
          <div className="flex items-center justify-between gap-3 pt-1"><h2 className="text-sm font-semibold">Sessioni</h2>
            <span className="text-xs text-muted-foreground">Le più recenti per prime</span></div>
          {sessions.loading && !sessions.data && <LoadingCards count={3} label="Caricamento delle sessioni…"/>}
          {!sessions.loading && !sessions.error && list.length === 0 && <EmptyWorkspace/>}
          <div className="grid items-stretch gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {list.map(session => <SessionCard key={session.id} session={session} now={now} open={() => navigate(session.id)}/>)}
          </div>
          {sessions.data?.nextCursor && <div className="flex justify-center"><Button variant="outline" disabled={sessions.loading}
            onClick={() => setSessionPages(old => old + 1)}>{sessions.loading ? "Caricamento…" : "Mostra altre sessioni"}</Button></div>}
        </> : <>
          {selected.loading && !overview && <LoadingCards count={2} label="Caricamento della sessione…"/>}
          {!overview && selected.error && <Card><CardContent className="py-8 text-center">
            <h1 className="text-xl font-semibold">Sessione non disponibile</h1>
            <p className="mt-3 text-sm text-muted-foreground">Verifica il collegamento oppure torna alle sessioni.</p>
            <Button variant="outline" className="mt-5" onClick={() => navigate(null)}>Tutte le sessioni<ArrowRight aria-hidden="true"/></Button>
          </CardContent></Card>}
          {overview && agent && <>
            <div className="space-y-4">
              <div><p className="mb-2 text-xs font-medium text-muted-foreground">{agent.parentAgentId ? "CONTRIBUTO DEL SUBAGENT" : "PERCORSO DELLA SESSIONE"}</p>
                <h1 className="wrap-anywhere text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{overview.session.title}</h1></div>
              <div className="flex flex-wrap items-center gap-2.5 text-sm"><AgentAvatar name={agent.name} small/><span className="min-w-0 max-w-full wrap-anywhere">{agent.name}</span>
                <StatusBadge status={agent.status}/><span className="ml-auto text-xs text-muted-foreground">Aggiornato {ago(agent.updatedAt, now)}</span></div>
            </div>
            <Separator/>
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
              <div className="min-w-0 space-y-6">
                {agent.parentAgentId && <Card className="gap-3 bg-muted/30 py-4"><CardContent className="flex gap-3 px-4">
                  <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
                  <div className="min-w-0"><h2 className="text-xs font-medium text-muted-foreground">Incarico</h2>
                    <p className="mt-2 wrap-anywhere text-sm leading-6">{agent.mandate}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{agent.integratedAt ? "✓ Contributo integrato dal genitore"
                      : agent.status === "completed" ? "Contributo concluso · integrazione non ancora registrata" : "Attività delegata"}</p>
                  </div>
                </CardContent></Card>}
                <Timeline key={agent.id} agent={agent} overview={overview} version={sessionVersion} now={now}
                  retry={retryData} chooseAgent={id => navigate(overview.session.id, id)}/>
              </div>
              <aside aria-label="Obiettivi della sessione" className="min-w-0 xl:sticky xl:top-6"><Goals goals={overview.goals}/></aside>
            </div>
          </>}
        </>}
      </div>
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>AOVerview</span><span>Un aggiornamento alla volta.</span>
      </footer>
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

function SessionMetrics({ sessions }: { sessions: SessionSummary[] }) {
  const running = sessions.reduce((sum, session) => sum + session.runningCount, 0);
  const completed = sessions.reduce((sum, session) => sum + session.completedGoals, 0);
  const total = sessions.reduce((sum, session) => sum + session.totalGoals, 0);
  const metrics = [
    { title: "Sessioni visualizzate", value: String(sessions.length), description: "Percorsi indipendenti", icon: Layers3 },
    { title: "Agent al lavoro", value: String(running), description: "Principali e subagent", icon: Activity },
    { title: "Obiettivi completati", value: `${completed} / ${total}`, description: "Nelle sessioni visualizzate", icon: Target },
  ];
  return <div className="grid gap-4 sm:grid-cols-3">{metrics.map(metric => <Card key={metric.title} className="metric-card gap-4">
    <CardHeader><CardDescription className="flex items-center justify-between gap-3 text-xs">{metric.title}<metric.icon className="size-4" aria-hidden="true"/></CardDescription></CardHeader>
    <CardContent><p className="text-3xl font-semibold tracking-tight">{metric.value}</p><p className="mt-2 text-xs text-muted-foreground">{metric.description}</p></CardContent>
  </Card>)}</div>;
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

function SessionCard({ session, now, open }: { session: SessionSummary; now: number; open: () => void }) {
  return <Card className="catalog-card relative gap-5">
    <CardHeader className="gap-4">
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Sessione</span>
        <StatusBadge status={session.currentBlock?.status === "blocked" && session.status === "running" ? "blocked" : session.status}/></div>
      <CardTitle><h3 className="wrap-anywhere text-lg leading-7"><button onClick={open}
        className="text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">{session.title}</button></h3></CardTitle>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><AgentAvatar name={session.rootAgentName} small/><span className="truncate">{session.rootAgentName}</span></div>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col gap-5">
      <div className="rounded-lg border bg-muted/30 p-3.5">
        <p className="text-[11px] text-muted-foreground">{session.status === "completed" ? "PERCORSO CONCLUSO" : "ATTIVITÀ CORRENTE"}</p>
        <p className="mt-2 wrap-anywhere text-sm leading-6">{session.currentBlock?.title ?? (session.status === "reserved" ? "In attesa di avvio"
          : session.status === "running" ? "In attesa del primo blocco" : "Consulta attività e risultati")}</p>
      </div>
      <div className="mt-auto space-y-3"><p className="text-xs text-muted-foreground">{session.completedGoals} di {session.totalGoals} obiettivi completati</p>
        <Progress value={session.totalGoals ? session.completedGoals / session.totalGoals * 100 : 0} aria-label="Obiettivi della sessione completati" className="h-1"/></div>
    </CardContent>
    <CardFooter className="flex-wrap justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><GitBranch className="size-3.5" aria-hidden="true"/>{session.agentCount === 1 ? "1 agent" : `1 agent · ${session.agentCount - 1} subagent`}</span>
      <UpdatedTime value={session.updatedAt} now={now}/>
      <Button variant="ghost" size="sm" className="relative z-10 ml-auto text-xs" onClick={open} aria-label={`Apri sessione: ${session.title}`}>Apri<ArrowUpRight className="size-3.5" aria-hidden="true"/></Button>
    </CardFooter>
  </Card>;
}
