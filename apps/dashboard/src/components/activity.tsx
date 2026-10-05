import { createContext, useContext, useMemo, useState } from "react";
import {
  Background, BackgroundVariant, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider,
  useReactFlow, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { Activity, ArrowUpRight, Check, Clock3, Focus, GitBranch, Layers3, Maximize, Minus, Plus, Target, X } from "lucide-react";
import type { AgentOverview, Block, SessionOverview } from "@aoverview/core/contracts";
import { usePages } from "../data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AgentAvatar, ErrorNotice, LoadingCards, StatusBadge, UpdatedTime } from "./overview-ui";
import { BlockDetails } from "./activity-details";
import { Goals } from "./goals";
import { BLOCK_HEIGHT, BLOCK_WIDTH, DELEGATE_HEIGHT, buildActivityGraph } from "./activity-graph";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface ActivityProps {
  agent: AgentOverview; overview: SessionOverview; version: string; now: number;
  retry: () => void; chooseAgent: (id: string) => void;
}
type BlockNode = Node<{ block: Block }, "block">;
type DelegateNode = Node<{ agent: AgentOverview }, "delegate">;
type ActivityNode = BlockNode | DelegateNode;
const nodeTypes = { block: ActivityBlockNode, delegate: ActivityDelegateNode };
const CanvasContext = createContext<{
  overview: SessionOverview; now: number; currentId: string | undefined; selectedId: string | null;
  selectBlock: (id: string) => void; chooseAgent: (id: string) => void;
} | null>(null);
function useCanvas() {
  const context = useContext(CanvasContext);
  if (!context) throw new Error("Activity canvas context missing");
  return context;
}

export function ActivityCanvas({ agent, overview, version, now, retry, chooseAgent }: ActivityProps) {
  const [pages, setPages] = useState(1);
  const [futurePages, setFuturePages] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=history`, version, pages);
  const future = usePages<Block>(`/api/v1/agents/${agent.id}/blocks?view=proposed`, version, futurePages);
  const graph = useMemo(() => buildActivityGraph({ agentId: agent.id, history: history.data?.items ?? [],
    proposed: future.data?.items ?? [], current: agent.currentBlock, agents: overview.agents }),
  [agent.id, agent.currentBlock, overview.agents, history.data, future.data]);
  const nodes = useMemo<ActivityNode[]>(() => graph.nodes.map(item => ({
    id: item.id, position: item.position, type: item.kind,
    data: item.kind === "block" ? { block: item.block } : { agent: item.agent },
    ariaLabel: item.kind === "block" ? item.block.title : `Subagent ${item.agent.name}`,
    width: BLOCK_WIDTH, height: item.kind === "block" ? BLOCK_HEIGHT : DELEGATE_HEIGHT,
    style: { pointerEvents: "all" },
  } as ActivityNode)), [graph.nodes]);
  const edges = useMemo<Edge[]>(() => graph.links.map(link => {
    const color = link.kind === "proposal" ? "#a1a1aa" : link.kind === "integration" ? "#34d399" : link.kind === "delegation" ? "#a78bfa" : "#71717a";
    return { id: link.id, source: link.source, target: link.target, type: "smoothstep",
      sourceHandle: link.kind === "delegation" ? "delegates" : link.kind === "integration" ? "integrated" : link.kind === "proposal" ? "plan" : "next",
      targetHandle: link.kind === "delegation" ? "parent" : link.kind === "integration" ? "integration" : link.kind === "proposal" ? "intention" : "previous",
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: 1.5, ...(link.kind === "proposal" || link.kind === "delegation" ? { strokeDasharray: "5 5" } : {}) },
      ariaLabel: link.kind === "sequence" ? "Attività avviata successivamente" : link.kind === "proposal" ? "Possibile prossimo passo"
        : link.kind === "integration" ? "Contributo integrato" : "Incarico delegato",
    };
  }), [graph.links]);
  const selected = [...graph.blocks, ...graph.future].find(block => block.id === selectedId);
  const error = history.error ?? future.error;
  const loading = history.loading || future.loading;

  return <CanvasContext.Provider value={{ overview, now, currentId: agent.currentBlock?.id, selectedId, selectBlock: setSelectedId, chooseAgent }}>
    <section aria-label="Canvas delle attività" className="activity-canvas absolute inset-0 overflow-hidden bg-background">
      {error && <div className="absolute top-28 right-4 left-4 z-30 max-w-md sm:left-5"><ErrorNotice message={error} retry={retry}/></div>}
      {history.data && future.data || error ? <>
        <ReactFlowProvider><CanvasStage nodes={nodes} edges={edges} focusId={graph.focusId}/></ReactFlowProvider>
        {graph.nodes.length === 0 && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center p-5"><div className="pointer-events-auto w-full max-w-sm"><EmptyActivity agent={agent}/></div></div>}
      </> : loading && <div className="absolute inset-0 grid place-items-center p-5"><div className="w-full max-w-sm"><LoadingCards/></div></div>}
      <FloatingGoals overview={overview}/>
      {(history.data?.nextCursor || future.data?.nextCursor) && <div className="absolute bottom-20 left-3 z-20 flex flex-wrap gap-2 sm:bottom-5 sm:left-5">
        {history.data?.nextCursor && <Button variant="outline" size="sm" disabled={history.loading}
          onClick={() => setPages(old => old + 1)}>{history.loading ? "Caricamento…" : "Attività precedenti"}</Button>}
        {future.data?.nextCursor && <Button variant="outline" size="sm" disabled={future.loading}
          onClick={() => setFuturePages(old => old + 1)}>Altre proposte</Button>}
      </div>}
      {selected && <section aria-label="Dettagli del blocco selezionato" className="absolute right-3 bottom-20 left-3 z-30 flex max-h-[55%] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-xl backdrop-blur sm:right-auto sm:bottom-5 sm:left-5 sm:max-h-[calc(100%-9rem)] sm:w-96">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"><h2 className="text-xs font-medium text-muted-foreground">Dettagli</h2>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Chiudi pannello dettagli" onClick={() => setSelectedId(null)}><X className="size-3.5" aria-hidden="true"/></Button></div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
        {selected.status === "proposed" ? <Card className="border-dashed"><CardContent>
          <h3 className="wrap-anywhere font-medium">{selected.title}</h3>
          {selected.summary && <p className="mt-3 wrap-anywhere text-sm leading-6 text-muted-foreground">{selected.summary}</p>}
          <p className="mt-4 text-xs text-muted-foreground">È un’intenzione: l’agent confermerà questo passaggio quando lo avvierà.</p>
        </CardContent></Card> : <BlockDetails key={selected.id} block={selected} overview={overview} version={version} now={now}
          chooseAgent={chooseAgent} highlighted={selected.id === agent.currentBlock?.id}/>}
        </div>
      </section>}
    </section>
  </CanvasContext.Provider>;
}

function CanvasStage({ nodes, edges, focusId }: { nodes: ActivityNode[]; edges: Edge[]; focusId: string | undefined }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow<ActivityNode>();
  return <div className="size-full" data-activity-graph>
    <ReactFlow<ActivityNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="dark"
      nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false}
      elementsSelectable={false} minZoom={0.18} maxZoom={1.6} panOnScroll zoomOnScroll={false}
      zoomOnPinch zoomOnDoubleClick={false} zoomActivationKeyCode={["Meta", "Control"]} preventScrolling deleteKeyCode={null}
      aria-label="Mappa dei blocchi di lavoro" fitView
      fitViewOptions={{ nodes: focusId ? [{ id: focusId }] : nodes, padding: 0.35, maxZoom: 1 }}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)"/>
      <Panel position="bottom-center" className="!mb-5">
        <div role="toolbar" aria-label="Navigazione canvas" className="flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-lg">
          <CanvasButton label="Riduci zoom" icon={Minus} onClick={() => void zoomOut({ duration: 150 })}/>
          <CanvasButton label="Aumenta zoom" icon={Plus} onClick={() => void zoomIn({ duration: 150 })}/>
          <span className="mx-1 h-4 border-l" aria-hidden="true"/>
          <CanvasButton label="Mostra tutti i blocchi" icon={Maximize} onClick={() => void fitView({ padding: 0.18, duration: 200, maxZoom: 1 })}/>
          <CanvasButton label="Centra attività più recente" icon={Focus} onClick={() => void fitView({ nodes: focusId ? [{ id: focusId }] : [], padding: 0.35, duration: 200, maxZoom: 1 })}/>
        </div>
      </Panel>
    </ReactFlow>
  </div>;
}

function FloatingGoals({ overview }: { overview: SessionOverview }) {
  const isMobile = useIsMobile();
  const [preference, setPreference] = useState<boolean | null>(null);
  const open = preference ?? !isMobile;
  return <aside aria-label="Obiettivi della sessione" className={cn("absolute top-3 right-3 z-30 sm:top-5 sm:right-5", open && "w-[min(280px,calc(100%-1.5rem))]")}>
    {open && <div id="canvas-goals" className="mt-24 max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain rounded-xl shadow-xl md:mt-0 md:max-h-[calc(100dvh-6rem)]"><Goals goals={overview.goals}/></div>}
    <Button variant={open && !isMobile ? "ghost" : "outline"} size="icon" className={cn(open ? "absolute top-0 right-0 size-10 bg-background/95 md:top-3 md:right-3 md:size-7 md:bg-transparent" : "size-10 bg-background/95 shadow-lg")}
      aria-label={open ? "Nascondi obiettivi" : "Mostra obiettivi"} aria-expanded={open} aria-controls="canvas-goals"
      title={open ? "Nascondi obiettivi" : "Mostra obiettivi"} onClick={() => setPreference(!open)}>
      {open ? <X className="size-4" aria-hidden="true"/> : <Target className="size-4" aria-hidden="true"/>}
    </Button>
  </aside>;
}

function CanvasButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Plus; onClick: () => void }) {
  return <Button variant="ghost" size="icon" className="size-8" title={label} aria-label={label} onClick={onClick}><Icon className="size-4" aria-hidden="true"/></Button>;
}

function ActivityBlockNode({ data: { block } }: NodeProps<BlockNode>) {
  const { overview, now, currentId, selectedId, selectBlock } = useCanvas();
  const current = block.id === currentId;
  const proposed = block.status === "proposed";
  const goal = overview.goals.find(goal => goal.id === block.goalId);
  return <>
    <Handle aria-hidden="true" type="target" position={Position.Top} id="previous"/>
    <Handle aria-hidden="true" type="source" position={Position.Bottom} id="next"/>
    <Handle aria-hidden="true" type="source" position={Position.Right} id="plan" style={{ top: "65%" }}/>
    <Handle aria-hidden="true" type="target" position={Position.Right} id="intention"/>
    <Handle aria-hidden="true" type="source" position={Position.Right} id="delegates" style={{ top: "35%" }}/>
    <Handle aria-hidden="true" type="target" position={Position.Right} id="integration" style={{ top: "82%" }}/>
    <button className="nodrag w-full text-left outline-none" onClick={() => selectBlock(block.id)} aria-label={`Apri blocco: ${block.title}`}
      aria-pressed={selectedId === block.id} title={block.title}>
      <Card className={cn("h-[220px] gap-3 rounded-xl px-4 py-4 shadow-lg transition-colors", proposed && "border-dashed bg-background",
        current && (block.status === "blocked" ? "border-amber-500/60" : "border-emerald-500/60"), selectedId === block.id && "ring-2 ring-ring",
        "focus-within:ring-2")}>
        <div className="flex items-center justify-between gap-2"><span className={cn("text-[10px] font-medium tracking-wider", current ? block.status === "blocked" ? "text-amber-400" : "text-emerald-400" : "text-muted-foreground")}>
          {current ? "ADESSO" : proposed ? "POSSIBILE PASSO" : "ATTIVITÀ"}</span><StatusBadge status={block.status} className="px-1.5 py-0.5 text-[10px]"/></div>
        <h3 className="line-clamp-2 text-sm leading-5 font-semibold wrap-anywhere">{block.title}</h3>
        {(block.concern ?? block.outcome ?? block.summary) && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground wrap-anywhere">{block.concern ?? block.outcome ?? block.summary}</p>}
        {goal && <span className="mt-auto flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground" title={goal.title}><Target className="size-3 shrink-0" aria-hidden="true"/><span className="truncate">{goal.title}</span></span>}
        <div className={cn("flex items-center justify-between gap-2 border-t pt-2 text-[10px] text-muted-foreground", !goal && "mt-auto")}>
          <span>{proposed ? "Da confermare" : block.detailCount ? `${block.detailCount} ${block.detailCount === 1 ? "passaggio" : "passaggi"}` : "Apri dettagli"}</span>
          <UpdatedTime value={block.updatedAt} now={now}/>
        </div>
      </Card>
    </button>
  </>;
}

function ActivityDelegateNode({ data: { agent } }: NodeProps<DelegateNode>) {
  const { chooseAgent } = useCanvas();
  return <>
    <Handle aria-hidden="true" type="target" position={Position.Left} id="parent"/>
    <Handle aria-hidden="true" type="source" position={Position.Bottom} id="integrated"/>
    <button className="nodrag w-full text-left outline-none" aria-label={`Apri subagent: ${agent.name}`} onClick={() => chooseAgent(agent.id)}>
      <Card className="h-[184px] gap-3 rounded-xl border-violet-400/25 px-4 py-4">
        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-violet-300"><GitBranch className="size-3" aria-hidden="true"/>SUBAGENT</span>
          <StatusBadge status={agent.status} className="px-1.5 py-0.5 text-[10px]"/></div>
        <div className="flex min-w-0 items-center gap-2"><AgentAvatar name={agent.name} small/><h3 className="truncate text-sm font-semibold">{agent.name}</h3></div>
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground wrap-anywhere">{agent.currentBlock?.title ?? agent.mandate}</p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2 text-[10px]">
          <span className={cn("flex items-center gap-1", agent.integratedAt ? "text-emerald-400" : "text-muted-foreground")}>
            {agent.integratedAt && <Check className="size-3" aria-hidden="true"/>}{agent.integratedAt ? "Integrato" : agent.status === "completed" ? "Da integrare" : "Attività delegata"}
          </span><ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden="true"/>
        </div>
      </Card>
    </button>
  </>;
}

function EmptyActivity({ agent }: { agent: AgentOverview }) {
  const reserved = agent.status === "reserved";
  const running = agent.status === "running";
  const Icon = reserved ? Clock3 : running ? Activity : Layers3;
  return <Card className="bg-muted/30"><CardContent className="flex gap-3">
    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true"/>
    <div><h2 className="text-sm font-medium">{reserved ? "Subagent registrato, avvio da confermare" : running ? "In attesa del prossimo aggiornamento" : "Nessuna attività registrata."}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{reserved ? "Il primo aggiornamento del subagent confermerà l’inizio del lavoro."
        : running ? "Il canvas prenderà forma quando l’agent comunicherà una nuova attività." : "L’agent ha concluso senza comunicare blocchi di lavoro."}</p></div>
  </CardContent></Card>;
}
