import { useEffect, useState } from "react";
import type { AgentOverview, AgentStatus, Block, BlockDetail, BlockStatus, Goal, GoalStatus, SessionOverview, SessionSummary } from "@aoverview/core/contracts";
import { useLiveUpdates, usePages, useResource } from "./data.js";
import { Icon } from "./icons.js";

const labels: Record<AgentStatus | BlockStatus | GoalStatus, string> = {
  reserved: "Da avviare", running: "In corso", pending: "Da fare", proposed: "Proposto",
  active: "In corso", blocked: "Bloccato", completed: "Completato", failed: "Non riuscito", cancelled: "Annullato",
};
const relative = new Intl.RelativeTimeFormat("it", { numeric: "auto" });
function ago(value: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  if (seconds < 60) return "adesso";
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), "hour");
  return relative.format(-Math.floor(seconds / 86400), "day");
}
function Status({ status }: { status: keyof typeof labels }) {
  const icon = status === "completed" ? "check" : status === "blocked" || status === "failed" ? "alert" : status === "active" || status === "running" ? "activity" : status === "cancelled" ? "close" : "clock";
  return <span className={`status status-${status}`}><Icon name={icon} size={13}/>{labels[status]}</span>;
}
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`} aria-hidden="true">{Array.from(name)[0]?.toUpperCase() ?? "A"}</span>;
}
function ErrorNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-notice" role="alert"><Icon name="alert"/><span>{message}</span><button onClick={retry}>Riprova</button></div>;
}
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
    url.search = "";
    if (sessionId) url.searchParams.set("session", sessionId);
    if (agentId) url.searchParams.set("agent", agentId);
    window.history.pushState(null, "", url);
    setSelection({ sessionId, agentId });
  }
  const list = sessions.data?.items ?? [];
  const overview = selected.data;
  const agent = overview?.agents.find(item => item.id === selection.agentId)
    ?? overview?.agents.find(item => item.id === overview.session.rootAgentId);
  const error = sessions.error ?? selected.error;

  return <>
    <a className="skip-link" href="#main">All’attività</a>
    <header className="app-header">
      <button className="brand" onClick={() => navigate(null)} aria-label="AOVerview, tutte le sessioni"><span className="brand-mark"><span/><span/><span/></span><span>AO<span className="brand-light">Verview</span></span></button>
      <span className="header-divider"/>
      <span className="header-caption">Il lavoro prende forma.</span>
      <div className="connection" role="status"><span className={`connection-dot ${live.connected ? "online" : ""}`}/>{live.connected ? "In diretta" : "Riconnessione…"}</div>
    </header>
    {error && <ErrorNotice message={error} retry={() => setRetry(old => old + 1)}/>}
    {!selection.sessionId ? <main id="main" tabIndex={-1} className="overview-page">
      <div className="page-heading"><div><p className="eyebrow">IL TUO SPAZIO DI LAVORO</p><h1>Una vista d’insieme.</h1><p className="muted">Obiettivi, progressi e prossimi passi. Per ogni agent.</p></div><span className="quiet-label"><Icon name="grid"/>{list.length} sessioni visualizzate</span></div>
      <section className="overview-intro"><div className="intro-icon"><Icon name="layers" size={28}/></div><div><p className="eyebrow">DALLE INTENZIONI AI RISULTATI</p><h2>Segui il percorso, un blocco alla volta.</h2><p>Ogni sessione raccoglie le attività dell’agent e i contributi dei suoi subagent.</p></div><div className="intro-decoration" aria-hidden="true"><span/><span/><span/></div></section>
      <div className="section-heading"><h2>Sessioni</h2><span className="muted">Le più recenti per prime</span></div>
      {sessions.loading && !sessions.data && <p className="loading" role="status">Caricamento delle sessioni…</p>}
      {!sessions.loading && !sessions.error && list.length === 0 && <div className="empty-state"><span className="empty-symbol"><Icon name="branch" size={30}/></span><h2>Il prossimo percorso inizia qui.</h2><p>Collega un agent al server MCP e assegnagli la skill AOVerview.<br/>La sua prima sessione comparirà automaticamente.</p><code>http://localhost:3001/mcp</code><p className="empty-footnote">Gli aggiornamenti descrivono il lavoro a livello macro.</p></div>}
      <div className="session-grid">{list.map(session => <button className="session-card" key={session.id} onClick={() => navigate(session.id)}>
        <div className="card-topline"><span className="card-label">SESSIONE</span><Status status={session.currentBlock?.status === "blocked" && session.status === "running" ? "blocked" : session.status}/></div>
        <h2>{session.title}</h2><div className="card-owner"><Avatar name={session.rootAgentName} small/><span>{session.rootAgentName}</span></div>
        <div className="current-preview"><span className="card-label">{session.status === "completed" ? "PERCORSO CONCLUSO" : "ATTIVITÀ CORRENTE"}</span><p>{session.currentBlock?.title ?? (session.status === "reserved" ? "In attesa di avvio" : session.status === "running" ? "In attesa del primo blocco" : "Consulta attività e risultati")}</p></div>
        <div className="card-goals"><span>{session.completedGoals} di {session.totalGoals} obiettivi completati</span><div className="progress-track"><span style={{ width: `${session.totalGoals ? session.completedGoals / session.totalGoals * 100 : 0}%` }}/></div></div>
        <div className="card-footer"><span><Icon name="branch" size={15}/>{session.agentCount === 1 ? "1 agent" : `1 agent · ${session.agentCount - 1} subagent`}</span><time title={new Date(session.updatedAt).toLocaleString("it")}>{ago(session.updatedAt, now)}</time><Icon name="arrow" size={16}/></div>
      </button>)}</div>
      {sessions.data?.nextCursor && <button className="more-button" disabled={sessions.loading} onClick={() => setSessionPages(old => old + 1)}>{sessions.loading ? "Caricamento…" : "Mostra altre sessioni"}</button>}
    </main> : <div className="workspace">
      <aside className="session-sidebar" aria-label="Sessioni e agent">
        <button className="back-button" onClick={() => navigate(null)}><Icon name="grid" size={16}/>Tutte le sessioni</button>
        <div className="sidebar-section-label">SESSIONI</div>
        <nav className="session-nav" aria-label="Seleziona una sessione">{list.map(session => <button key={session.id} className={`session-nav-item ${session.id === selection.sessionId ? "selected" : ""}`} aria-current={session.id === selection.sessionId ? "page" : undefined} onClick={() => navigate(session.id)}><span className={`tiny-dot dot-${session.status}`}/><span>{session.title}</span></button>)}</nav>
        {sessions.data?.nextCursor && <button className="text-button" disabled={sessions.loading} onClick={() => setSessionPages(old => old + 1)}>Altre sessioni</button>}
        {overview && <><div className="sidebar-section-label agent-section-label">AGENT DELLA SESSIONE <span>{overview.agents.length}</span></div><AgentTree agents={overview.agents} parentId={null} selectedId={agent?.id ?? ""} choose={id => navigate(overview.session.id, id)}/></>}
        <div className="sidebar-note"><Icon name="clock" size={15}/><p>Lo stato è comunicato dagli agent. L’ultimo aggiornamento indica quanto è recente.</p></div>
      </aside>
      <main id="main" tabIndex={-1} className="activity-main">
        {selected.loading && !overview && <p className="loading" role="status">Caricamento della sessione…</p>}
        {!overview && selected.error && <div className="empty-state compact"><h1>Sessione non disponibile</h1><p>Verifica il collegamento oppure torna alle sessioni.</p><button className="more-button" onClick={() => navigate(null)}>Tutte le sessioni</button></div>}
        {overview && agent && <>
          <div className="session-title"><p className="eyebrow">{agent.parentAgentId ? "CONTRIBUTO DEL SUBAGENT" : "PERCORSO DELLA SESSIONE"}</p><h1>{overview.session.title}</h1><div className="session-title-meta"><Avatar name={agent.name} small/><span>{agent.name}</span><Status status={agent.status}/><span className="updated-label">Aggiornato {ago(agent.updatedAt, now)}</span></div></div>
          {agent.parentAgentId && <div className="mandate-card"><Icon name="branch"/><div><span className="card-label">INCARICO</span><p>{agent.mandate}</p><span className="integration-label">{agent.integratedAt ? "✓ Contributo integrato dal genitore" : agent.status === "completed" ? "Contributo concluso · integrazione non ancora registrata" : "Attività delegata"}</span></div></div>}
          <Timeline key={agent.id} agent={agent} overview={overview} version={sessionVersion} now={now} retry={() => setRetry(old => old + 1)} chooseAgent={id => navigate(overview.session.id, id)}/>
        </>}
      </main>
      <aside className="goals-sidebar" aria-label="Obiettivi della sessione">
        {overview && <Goals goals={overview.goals}/>}
      </aside>
    </div>}
    <footer className="app-footer"><span>AOVerview</span><span>Un aggiornamento alla volta.</span></footer>
  </>;
}

function AgentTree({ agents, parentId, selectedId, choose, depth = 0 }: { agents: AgentOverview[]; parentId: string | null; selectedId: string; choose: (id: string) => void; depth?: number }) {
  return <div className="agent-tree">{agents.filter(agent => agent.parentAgentId === parentId).map(agent => <div key={agent.id}>
    <button className={`agent-nav-item ${agent.id === selectedId ? "selected" : ""}`} style={{ paddingLeft: `${10 + Math.min(depth, 4) * 12}px` }} aria-current={agent.id === selectedId ? "true" : undefined} onClick={() => choose(agent.id)}><Avatar name={agent.name} small/><span className="agent-nav-text"><strong>{agent.name}</strong><span>{agent.parentAgentId ? "Subagent" : "Agent principale"} · {labels[agent.status]}</span></span></button>
    <AgentTree agents={agents} parentId={agent.id} selectedId={selectedId} choose={choose} depth={depth + 1}/>
  </div>)}</div>;
}

function Goals({ goals }: { goals: Goal[] }) {
  const completed = goals.filter(goal => goal.status === "completed").length;
  return <><div className="goals-heading"><span className="goal-symbol"><Icon name="target" size={22}/></span><h2>Obiettivi</h2></div><p className="goals-caption">La direzione del lavoro, per tutta la sessione.</p>
    {goals.length > 0 && <div className="goal-progress"><strong>{completed}<span> / {goals.length}</span></strong><span>completati</span><div className="progress-track"><span style={{ width: `${completed / goals.length * 100}%` }}/></div></div>}
    <ol className="goal-list">{goals.map(goal => <li key={goal.id} className={`goal-item goal-${goal.status}`}><span className="goal-check" aria-hidden="true">{goal.status === "completed" ? <Icon name="check" size={14}/> : goal.status === "blocked" ? <Icon name="alert" size={13}/> : goal.status === "cancelled" ? <Icon name="close" size={13}/> : null}</span><div><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}<span className="goal-state">{labels[goal.status]}</span></div></li>)}</ol>
    {goals.length === 0 && <p className="muted goals-empty">L’agent non ha ancora definito gli obiettivi.</p>}
    <div className="goals-note"><span className="tiny-square"/><p>Un obiettivo può attraversare più blocchi. Il suo completamento viene confermato dall’agent principale.</p></div>
  </>;
}

function Timeline({ agent, overview, version, now, retry, chooseAgent }: { agent: AgentOverview; overview: SessionOverview; version: string; now: number; retry: () => void; chooseAgent: (id: string) => void }) {
  const [pages, setPages] = useState(1);
  const [futurePages, setFuturePages] = useState(1);
  const history = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=history`, version, pages);
  const future = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=proposed`, version, futurePages);
  const blocks = history.data?.items ?? [];
  const current = agent.currentBlock;
  const previous = blocks.filter(block => block.id !== current?.id);
  const error = history.error ?? future.error;
  return <div className="timeline-wrap">
    {error && <ErrorNotice message={error} retry={retry}/>}
    {current && <section className="current-section"><div className="section-heading"><h2>Adesso</h2><span className="section-pill">{current.status === "blocked" ? "Serve attenzione" : "Attività corrente"}</span></div><BlockCard block={current} overview={overview} version={version} now={now} chooseAgent={chooseAgent} highlighted/></section>}
    {!current && agent.status === "running" && <div className="waiting-card"><Icon name="activity"/><div><strong>In attesa del prossimo aggiornamento</strong><p>L’agent non ha un blocco in corso. La vista si aggiorna quando comunica una nuova attività.</p></div></div>}
    {agent.status === "reserved" && <div className="waiting-card"><Icon name="clock"/><div><strong>Subagent registrato, avvio da confermare</strong><p>Il primo aggiornamento del subagent confermerà l’inizio del lavoro.</p></div></div>}
    {previous.length > 0 && <section><div className="section-heading"><h2>Attività recente</h2><span className="muted">Dalla più recente</span></div><div className="timeline">{previous.map(block => <BlockCard key={block.id} block={block} overview={overview} version={version} now={now} chooseAgent={chooseAgent}/>)}</div></section>}
    {history.loading && !history.data && <p className="loading" role="status">Caricamento delle attività…</p>}
    {history.data?.nextCursor && <button className="more-button" disabled={history.loading} onClick={() => setPages(old => old + 1)}>{history.loading ? "Caricamento…" : "Mostra attività precedenti"}</button>}
    {(future.data?.items.length ?? 0) > 0 && <section className="next-section"><div className="section-heading"><h2>Possibili prossimi passi</h2><span className="tentative-label">Da confermare</span></div><p className="next-caption">Il piano può cambiare con ciò che emerge dal lavoro.</p><div className="proposed-list">{future.data!.items.map(block => <article key={block.id} className="proposed-card"><span className="proposed-marker"><Icon name="arrow" size={15}/></span><div><h3>{block.title}</h3>{block.summary && <p>{block.summary}</p>}</div><Status status="proposed"/></article>)}</div>{future.data?.nextCursor && <button className="text-button" disabled={future.loading} onClick={() => setFuturePages(old => old + 1)}>Altre proposte</button>}</section>}
    {!history.loading && !future.loading && !history.error && !future.error && !current && agent.status !== "running" && agent.status !== "reserved" && blocks.length === 0 && (future.data?.items.length ?? 0) === 0 && <div className="empty-state compact"><span className="empty-symbol"><Icon name="layers" size={25}/></span><h2>Nessuna attività registrata.</h2><p>L’agent ha concluso senza comunicare blocchi di lavoro.</p></div>}
  </div>;
}

function BlockCard({ block, overview, version, now, chooseAgent, highlighted = false }: { block: Block; overview: SessionOverview; version: string; now: number; chooseAgent: (id: string) => void; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const detail = useResource<BlockDetail>(expanded ? `/api/v1/agents/${block.agentId}/blocks/${block.id}` : null, `${version}:${retry}`);
  const children = overview.agents.filter(agent => agent.parentAgentId === block.agentId && agent.parentBlockId === block.id);
  const goal = overview.goals.find(item => item.id === block.goalId);
  return <article className={`block-card block-${block.status} ${highlighted ? "highlighted" : ""}`}>
    <div className="block-topline"><Status status={block.status}/><time title={new Date(block.updatedAt).toLocaleString("it")}>{ago(block.updatedAt, now)}</time></div>
    <button className="block-title" aria-expanded={expanded} aria-controls={`detail-${block.agentId}-${block.id}`} onClick={() => setExpanded(old => !old)}><h3>{block.title}</h3><Icon name="chevron" style={{ transform: expanded ? "rotate(90deg)" : undefined }}/></button>
    {block.summary && <p className="block-summary">{block.summary}</p>}
    {block.outcome && <div className="outcome"><Icon name="check" size={16}/><p>{block.outcome}</p></div>}
    {block.concern && <div className="concern"><Icon name="alert" size={16}/><p>{block.concern}</p></div>}
    <div className="block-meta">{goal && <span><Icon name="target" size={13}/>{goal.title}</span>}<button className="detail-toggle" onClick={() => setExpanded(old => !old)} aria-expanded={expanded} aria-controls={`detail-${block.agentId}-${block.id}`}>{expanded ? "Chiudi dettagli" : `${block.detailCount ? `${block.detailCount} ${block.detailCount === 1 ? "passaggio" : "passaggi"}` : "Apri dettagli"}`}</button></div>
    <div id={`detail-${block.agentId}-${block.id}`} hidden={!expanded} className="block-details">
      {detail.loading && !detail.data && <p className="loading" role="status">Caricamento dei dettagli…</p>}
      {detail.error && <ErrorNotice message={detail.error} retry={() => setRetry(old => old + 1)}/>}
      {detail.data && <><span className="card-label">PASSAGGI SVOLTI</span>{detail.data.details.length === 0 ? <p className="muted">Non sono ancora stati aggiunti passaggi.</p> : <ol className="detail-list">{detail.data.details.map((item, index) => <li key={item.id}><span className="step-number">{index + 1}</span><div><p>{item.action}</p>{item.result && <p className="step-result">{item.result}</p>}</div></li>)}</ol>}</>}
    </div>
    {children.length > 0 && <details className="delegation-group"><summary><Icon name="branch" size={16}/><span>{children.length === 1 ? "Un contributo delegato" : `${children.length} contributi delegati`}</span><Icon name="chevron" size={14}/></summary><div className="delegation-list">{children.map(child => <div className="delegation-card" key={child.id}><div className="delegation-heading"><Avatar name={child.name} small/><strong>{child.name}</strong><Status status={child.status}/></div><p>{child.mandate}</p>{child.currentBlock && <p className="delegation-current"><Icon name="activity" size={14}/>{child.currentBlock.title}</p>}<div className="delegation-footer"><span className={child.integratedAt ? "integrated" : "muted"}>{child.integratedAt ? "✓ Integrato" : child.status === "completed" ? "Pronto · da integrare" : child.status === "reserved" ? "Avvio da confermare" : labels[child.status]}</span><button onClick={() => chooseAgent(child.id)}>Apri attività<Icon name="arrow" size={14}/></button></div>{child.integrationNote && <p className="integration-note">{child.integrationNote}</p>}</div>)}</div></details>}
  </article>;
}
