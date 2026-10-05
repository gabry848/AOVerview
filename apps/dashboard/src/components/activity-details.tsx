import { useEffect, useState } from "react";
import { ArrowUpRight, GitBranch, Target, X } from "lucide-react";
import type { AgentOverview, Block, BlockDetail, SessionOverview } from "@aoverview/core/contracts";
import { useResource } from "../data";
import { Button } from "@/components/ui/button";
import { StatusIndicator, UpdatedTime, statusLabels } from "./overview-ui";

export function BlockDetails({ block, overview, version, now, chooseAgent, close }: {
  block: Block; overview: SessionOverview; version: string; now: number;
  chooseAgent: (id: string) => void; close: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const proposed = block.status === "proposed";
  const detail = useResource<BlockDetail>(proposed ? null : `/api/v1/agents/${block.agentId}/blocks/${block.id}`, `${version}:${retry}`);
  const children = overview.agents.filter(agent => agent.parentAgentId === block.agentId && agent.parentBlockId === block.id);
  const goal = overview.goals.find(item => item.id === block.goalId);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);

  return <>
    <header className="shrink-0 border-b px-5 py-4">
      <div className="flex items-start gap-2.5"><StatusIndicator status={block.status} className="mt-1"/>
        <h2 className="min-w-0 flex-1 wrap-anywhere text-sm leading-6 font-semibold">{block.title}</h2>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-8 shrink-0" aria-label="Chiudi pannello dettagli" onClick={close}>
          <X className="size-4" aria-hidden="true"/>
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{statusLabels[block.status]}</span><span className="flex items-center gap-1.5">Creato <UpdatedTime value={block.createdAt} now={now} label="Creato"/></span>
      </div>
    </header>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
      {goal && <p className="mb-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true"/>
        <span className="wrap-anywhere">{goal.title}</span></p>}
      {block.summary && block.summary !== block.outcome && <p className="mb-4 wrap-anywhere text-sm leading-6 whitespace-pre-line text-muted-foreground">{block.summary}</p>}
      {proposed && <p className="text-sm leading-6 text-muted-foreground">Passaggio da confermare. L’agent lo attiverà quando inizierà il lavoro.</p>}
      {block.outcome && <div className="mb-5"><h3 className="mb-1 text-xs text-muted-foreground">Esito dell’attività</h3>
        <p className="wrap-anywhere text-sm leading-6 whitespace-pre-line">{block.outcome}</p></div>}
      {block.concern && <div role="note" className="mb-5 border-l-2 border-amber-400/50 pl-3">
        <h3 className="mb-1 text-xs font-medium text-amber-300">Punto di attenzione</h3>
        <p className="wrap-anywhere text-sm leading-6 whitespace-pre-line text-amber-200/90">{block.concern}</p>
      </div>}
      {!proposed && <section data-block-details aria-label="Passaggi svolti">
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">Passaggi{detail.data && detail.data.details.length > 0 && ` · ${detail.data.details.length}`}</h3>
        {detail.loading && !detail.data && <p role="status" className="text-sm text-muted-foreground">Caricamento…</p>}
        {detail.error && <div role="alert" className="space-y-2 text-sm"><p className="text-red-400">{detail.error}</p>
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setRetry(old => old + 1)}>Riprova</Button></div>}
        {detail.data && (detail.data.details.length === 0
          ? <p className="text-sm leading-6 text-muted-foreground">L’agent non ha ancora riportato passaggi.</p>
          : <ol className="divide-y">{detail.data.details.map(item => <li key={item.id} className="py-4 first:pt-0 last:pb-0">
            <dl className="space-y-2.5">
              <div><dt className="text-[11px] text-muted-foreground">Azione</dt><dd className="mt-0.5 wrap-anywhere text-sm leading-6 font-medium whitespace-pre-line">{item.action}</dd></div>
              {item.result && <div><dt className="text-[11px] text-muted-foreground">Esito</dt><dd className="mt-0.5 wrap-anywhere text-sm leading-6 whitespace-pre-line">{item.result}</dd></div>}
              {item.reference && <div><dt className="text-[11px] text-muted-foreground">Riferimento</dt><dd className="mt-1 wrap-anywhere font-mono text-xs leading-5 whitespace-pre-line text-muted-foreground">{item.reference}</dd></div>}
            </dl>
          </li>)}</ol>)}
      </section>}
      {children.length > 0 && <section className="mt-5 border-t pt-4" aria-label="Contributi dei subagent">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><GitBranch className="size-3.5" aria-hidden="true"/>Subagent · {children.length}</h3>
        <ul className="divide-y">{children.map(child => <DelegationRow key={child.id} child={child} chooseAgent={chooseAgent}/>)}</ul>
      </section>}
    </div>
  </>;
}

function DelegationRow({ child, chooseAgent }: { child: AgentOverview; chooseAgent: (id: string) => void }) {
  const status = child.currentBlock?.status === "blocked" ? "blocked" : child.status;
  const stage = child.integratedAt ? "Integrato" : child.status === "completed" ? "Da integrare" : statusLabels[status];
  return <li className="py-3 first:pt-0 last:pb-0">
    <button onClick={() => chooseAgent(child.id)} aria-label={`Apri subagent: ${child.name}`}
      className="group flex w-full items-center gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StatusIndicator status={status}/><span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium group-hover:underline">{child.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{stage}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true"/>
    </button>
    {(child.integrationNote ?? child.mandate) && <p className="mt-1.5 wrap-anywhere text-xs leading-5 text-muted-foreground">{child.integrationNote ?? child.mandate}</p>}
  </li>;
}
