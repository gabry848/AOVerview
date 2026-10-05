import { CircleDot, GitBranch, LayoutDashboard } from "lucide-react";
import type { AgentOverview, SessionOverview, SessionSummary } from "@aoverview/core/contracts";
import { Button } from "@/components/ui/button";
import {
  SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, useSidebar,
} from "@/components/ui/sidebar";
import { AgentAvatar, statusLabels } from "./overview-ui";
import { cn } from "@/lib/utils";

export interface NavigationProps {
  sessions: SessionSummary[];
  sessionId: string | null;
  overview: SessionOverview | null;
  agentId: string | undefined;
  navigate: (sessionId: string | null, agentId?: string | null) => void;
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
}

export function Navigation({ sessions, sessionId, overview, agentId, navigate, hasMore, loading, loadMore }: NavigationProps) {
  const { setOpenMobile } = useSidebar();
  function choose(id: string | null, childId: string | null = null) {
    navigate(id, childId);
    setOpenMobile(false);
  }
  return <>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton tooltip="Vista d’insieme" isActive={!sessionId} onClick={() => choose(null)}
            aria-current={!sessionId ? "page" : undefined}>
            <LayoutDashboard aria-hidden="true"/><span>Vista d’insieme</span>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Sessioni</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu aria-label="Seleziona una sessione">
            {sessions.map(session => <SidebarMenuItem key={session.id}>
              <SidebarMenuButton tooltip={session.title} isActive={session.id === sessionId}
                aria-current={session.id === sessionId ? "page" : undefined} onClick={() => choose(session.id)}>
                <CircleDot className={cn(session.status === "running" ? "text-emerald-400" : session.status === "failed" ? "text-red-400" : "text-muted-foreground")} aria-hidden="true"/>
                <span>{session.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>)}
          </SidebarMenu>
          {sessions.length === 0 && !loading && <p className="px-2 py-2 text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">Le prime sessioni compariranno qui.</p>}
          {hasMore && <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground group-data-[collapsible=icon]:hidden"
            disabled={loading} onClick={loadMore}>Altre sessioni</Button>}
        </SidebarGroupContent>
      </SidebarGroup>
      {overview && <SidebarGroup>
        <SidebarGroupLabel><GitBranch className="mr-2 size-3.5" aria-hidden="true"/>Agent della sessione</SidebarGroupLabel>
        <SidebarGroupContent><AgentTree agents={overview.agents} parentId={null} selectedId={agentId ?? ""}
          choose={id => choose(overview.session.id, id)}/></SidebarGroupContent>
      </SidebarGroup>}
    </SidebarContent>
  </>;
}

function AgentTree({ agents, parentId, selectedId, choose, depth = 0 }: {
  agents: AgentOverview[]; parentId: string | null; selectedId: string; choose: (id: string) => void; depth?: number;
}) {
  const rows = agents.filter(agent => agent.parentAgentId === parentId).map(agent => <SidebarMenuItem key={agent.id}>
    <SidebarMenuButton tooltip={`${agent.name} · ${statusLabels[agent.status]}`} isActive={agent.id === selectedId}
      aria-label={`${agent.name} ${agent.parentAgentId ? "Subagent" : "Principale"} · ${statusLabels[agent.status]}`}
      aria-current={agent.id === selectedId ? "true" : undefined} onClick={() => choose(agent.id)}>
      <AgentAvatar name={agent.name} small/><span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">{agent.name}</span>
      <span className={cn("ml-auto size-1.5 shrink-0 rounded-full group-data-[collapsible=icon]:hidden",
        agent.status === "running" ? "bg-emerald-400" : agent.status === "failed" ? "bg-red-400" : "bg-muted-foreground/50")} aria-hidden="true"/>
    </SidebarMenuButton>
    <AgentTree agents={agents} parentId={agent.id} selectedId={selectedId} choose={choose} depth={depth + 1}/>
  </SidebarMenuItem>);
  if (rows.length === 0) return null;
  return parentId && depth <= 4 ? <SidebarMenuSub>{rows}</SidebarMenuSub> : <SidebarMenu>{rows}</SidebarMenu>;
}
