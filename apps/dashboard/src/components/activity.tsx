import { useState } from "react";
import { Activity, ArrowRight, Check, ChevronRight, Clock3, GitBranch, Layers3, OctagonAlert, Target } from "lucide-react";
import type { AgentOverview, Block, BlockDetail, SessionOverview } from "@aoverview/core/contracts";
import { usePages, useResource } from "../data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar, ErrorNotice, LoadingCards, StatusBadge, UpdatedTime, statusLabels } from "./overview-ui";
import { cn } from "@/lib/utils";

interface ActivityProps {
  agent: AgentOverview; overview: SessionOverview; version: string; now: number;
  retry: () => void; chooseAgent: (id: string) => void;
}

export function Timeline({ agent, overview, version, now, retry, chooseAgent }: ActivityProps) {
  const [pages, setPages] = useState(1);
  const [futurePages, setFuturePages] = useState(1);
  const history = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=history`, version, pages);
  const future = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=proposed`, version, futurePages);
  const blocks = history.data?.items ?? [];
  const current = agent.currentBlock;
  const previous = blocks.filter(block => block.id !== current?.id);
  const error = history.error ?? future.error;

  return <div className="space-y-8">
    {error && <ErrorNotice message={error} retry={retry}/>}
    {current && <section className="current-section space-y-4" aria-labelledby="current-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="current-heading" className="flex items-center gap-2 text-sm font-semibold"><span className={cn("size-2 rounded-full", current.status === "blocked" ? "bg-amber-500" : "bg-emerald-500")} aria-hidden="true"/>Adesso</h2>
        <span className="text-xs text-muted-foreground">{current.status === "blocked" ? "Serve attenzione" : "Attività corrente"}</span>
      </div>
      <BlockCard key={current.id} block={current} overview={overview} version={version} now={now} chooseAgent={chooseAgent} highlighted/>
    </section>}
    {!current && agent.status === "running" && <WaitingCard title="In attesa del prossimo aggiornamento"
      description="L’agent non ha un blocco in corso. La vista si aggiorna quando comunica una nuova attività."/>}
    {agent.status === "reserved" && <WaitingCard reserved title="Subagent registrato, avvio da confermare"
      description="Il primo aggiornamento del subagent confermerà l’inizio del lavoro."/>}
    {previous.length > 0 && <section className="space-y-4" aria-labelledby="history-heading">
      <div className="flex items-center justify-between gap-3"><h2 id="history-heading" className="text-sm font-semibold">Attività recente</h2>
        <span className="text-xs text-muted-foreground">Dalla più recente</span></div>
      <div className="space-y-4 border-l pl-4 sm:pl-5">
        {previous.map(block => <div key={block.id} className="relative">
          <span className="absolute top-6 -left-[21px] size-2 rounded-full border bg-background sm:-left-[25px]" aria-hidden="true"/>
          <BlockCard block={block} overview={overview} version={version} now={now} chooseAgent={chooseAgent}/>
        </div>)}
      </div>
    </section>}
    {history.loading && !history.data && <LoadingCards/>}
    {history.data?.nextCursor && <div className="flex justify-center"><Button variant="outline" disabled={history.loading}
      onClick={() => setPages(old => old + 1)}>{history.loading ? "Caricamento…" : "Mostra attività precedenti"}</Button></div>}
    {(future.data?.items.length ?? 0) > 0 && <section className="space-y-4" aria-labelledby="future-heading">
      <div><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="future-heading" className="text-sm font-semibold">Possibili prossimi passi</h2>
        <Badge variant="outline" className="border-dashed text-muted-foreground">Da confermare</Badge></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Il piano può cambiare con ciò che emerge dal lavoro.</p></div>
      <div className="space-y-3">{future.data!.items.map(block => <Card key={block.id} role="article"
        className="border-dashed bg-muted/20 py-4">
        <CardContent className="flex items-start gap-3 px-4">
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
          <div className="min-w-0 flex-1"><h3 className="wrap-anywhere text-sm font-medium">{block.title}</h3>
            {block.summary && <p className="mt-1.5 wrap-anywhere text-sm leading-6 text-muted-foreground">{block.summary}</p>}</div>
          <StatusBadge status="proposed" className="shrink-0"/>
        </CardContent>
      </Card>)}</div>
      {future.data?.nextCursor && <Button variant="ghost" size="sm" disabled={future.loading}
        onClick={() => setFuturePages(old => old + 1)}>Altre proposte</Button>}
    </section>}
    {!history.loading && !future.loading && !error && !current && agent.status !== "running" && agent.status !== "reserved"
      && blocks.length === 0 && (future.data?.items.length ?? 0) === 0 && <Card><CardContent className="flex flex-col items-center gap-3 py-6 text-center">
        <Layers3 className="size-7 text-muted-foreground" aria-hidden="true"/><h2 className="font-medium">Nessuna attività registrata.</h2>
        <p className="text-sm text-muted-foreground">L’agent ha concluso senza comunicare blocchi di lavoro.</p>
      </CardContent></Card>}
  </div>;
}

function WaitingCard({ title, description, reserved = false }: { title: string; description: string; reserved?: boolean }) {
  const WaitingIcon = reserved ? Clock3 : Activity;
  return <Card className="bg-muted/30"><CardContent className="flex gap-3">
    <WaitingIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true"/>
    <div><h2 className="text-sm font-medium">{title}</h2><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p></div>
  </CardContent></Card>;
}

function BlockCard({ block, overview, version, now, chooseAgent, highlighted = false }: {
  block: Block; overview: SessionOverview; version: string; now: number; chooseAgent: (id: string) => void; highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const detail = useResource<BlockDetail>(expanded ? `/api/v1/agents/${block.agentId}/blocks/${block.id}` : null, `${version}:${retry}`);
  const children = overview.agents.filter(agent => agent.parentAgentId === block.agentId && agent.parentBlockId === block.id);
  const goal = overview.goals.find(item => item.id === block.goalId);

  return <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
    <Card role="article" className={cn("gap-4 py-5", highlighted && (block.status === "blocked" ? "border-amber-500/30" : "border-emerald-500/30"))}>
      <CardHeader className="gap-4 px-5">
        <div className="flex items-center justify-between gap-3"><StatusBadge status={block.status}/><UpdatedTime value={block.updatedAt} now={now}/></div>
        <h3><CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full justify-between gap-4 p-0 text-left text-base leading-6 font-semibold whitespace-normal hover:bg-transparent aria-expanded:bg-transparent">
          <span className="min-w-0 wrap-anywhere">{block.title}</span><ChevronRight className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden="true"/>
        </Button></CollapsibleTrigger></h3>
        {block.summary && <p className="wrap-anywhere text-sm leading-6 whitespace-pre-line text-muted-foreground">{block.summary}</p>}
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {block.outcome && <Alert role="note" className="border-0 bg-muted/60 px-3 py-2.5">
          <Check aria-hidden="true"/><AlertDescription className="wrap-anywhere leading-6 whitespace-pre-line text-foreground">{block.outcome}</AlertDescription>
        </Alert>}
        {block.concern && <Alert role="note" className="border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-amber-300">
          <OctagonAlert aria-hidden="true"/><AlertTitle>Punto di attenzione</AlertTitle>
          <AlertDescription className="wrap-anywhere leading-6 whitespace-pre-line text-amber-200/90">{block.concern}</AlertDescription>
        </Alert>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {goal && <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><Target className="size-3.5 shrink-0" aria-hidden="true"/><span className="wrap-anywhere">{goal.title}</span></span>}
          <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="ml-auto text-xs text-muted-foreground">
            {expanded ? "Chiudi dettagli" : block.detailCount ? `${block.detailCount} ${block.detailCount === 1 ? "passaggio" : "passaggi"}` : "Apri dettagli"}
          </Button></CollapsibleTrigger>
        </div>
        <CollapsibleContent className="space-y-5" data-block-details>
          <Separator/>
          {detail.loading && !detail.data && <p className="text-sm text-muted-foreground" role="status">Caricamento dei dettagli…</p>}
          {detail.error && <ErrorNotice message={detail.error} retry={() => setRetry(old => old + 1)}/>}
          {detail.data && <div>
            <h4 className="mb-4 text-xs font-medium text-muted-foreground">Passaggi svolti</h4>
            {detail.data.details.length === 0 ? <p className="text-sm text-muted-foreground">Non sono ancora stati aggiunti passaggi.</p>
              : <ol className="space-y-5">{detail.data.details.map((item, index) => <li key={item.id} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground" aria-hidden="true">{index + 1}</span>
                <div className="min-w-0"><p className="wrap-anywhere text-sm leading-6 whitespace-pre-line">{item.action}</p>
                  {item.result && <p className="mt-1 wrap-anywhere text-sm leading-6 whitespace-pre-line text-muted-foreground">{item.result}</p>}</div>
              </li>)}</ol>}
          </div>}
        </CollapsibleContent>
        {children.length > 0 && <Delegations children={children} chooseAgent={chooseAgent}/>}
      </CardContent>
    </Card>
  </Collapsible>;
}

function Delegations({ children, chooseAgent }: { children: AgentOverview[]; chooseAgent: (id: string) => void }) {
  return <Collapsible className="group/delegations space-y-4">
    <Separator/>
    <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full justify-between gap-2 px-0 text-xs text-muted-foreground hover:bg-transparent aria-expanded:bg-transparent">
      <span className="flex items-center gap-2"><GitBranch className="size-3.5" aria-hidden="true"/>
        {children.length === 1 ? "Un contributo delegato" : `${children.length} contributi delegati`}</span>
      <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/delegations:rotate-90" aria-hidden="true"/>
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="space-y-3">
      {children.map(child => <Card key={child.id} className="gap-3 bg-muted/30 py-3">
        <CardContent className="space-y-3 px-3">
          <div className="flex flex-wrap items-center gap-2"><AgentAvatar name={child.name} small/>
            <h4 className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">{child.name}</h4><StatusBadge status={child.status}/></div>
          <p className="wrap-anywhere text-sm leading-6 text-muted-foreground">{child.mandate}</p>
          {child.currentBlock && <p className="flex items-start gap-2 text-xs leading-5"><Activity className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden="true"/>
            <span className="wrap-anywhere">{child.currentBlock.title}</span></p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn("flex items-center gap-1.5 text-xs", child.integratedAt ? "text-emerald-400" : "text-muted-foreground")}>
              {child.integratedAt && <Check className="size-3" aria-hidden="true"/>}
              {child.integratedAt ? "Integrato" : child.status === "completed" ? "Pronto · da integrare" : child.status === "reserved" ? "Avvio da confermare" : statusLabels[child.status]}
            </span>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => chooseAgent(child.id)}>Apri attività<ArrowRight className="size-3.5" aria-hidden="true"/></Button>
          </div>
          {child.integrationNote && <p className="border-t pt-3 wrap-anywhere text-xs leading-5 text-muted-foreground">{child.integrationNote}</p>}
        </CardContent>
      </Card>)}
    </CollapsibleContent>
  </Collapsible>;
}
