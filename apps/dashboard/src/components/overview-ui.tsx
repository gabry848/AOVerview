import { Activity, AlertCircle, Check, Clock3, RefreshCw, X } from "lucide-react";
import type { AgentStatus, BlockStatus, GoalStatus } from "@aoverview/core/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Status = AgentStatus | BlockStatus | GoalStatus;
export const statusLabels: Record<Status, string> = {
  reserved: "Da avviare", running: "In corso", pending: "Da fare", proposed: "Proposto",
  active: "In corso", blocked: "Bloccato", completed: "Completato", failed: "Non riuscito", cancelled: "Annullato",
};
const statusClasses: Record<Status, string> = {
  running: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  completed: "border-border bg-secondary text-secondary-foreground",
  blocked: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  failed: "border-red-500/25 bg-red-500/10 text-red-400",
  cancelled: "border-border bg-muted text-muted-foreground",
  proposed: "border-dashed bg-background text-muted-foreground",
  reserved: "border-border bg-background text-muted-foreground",
  pending: "border-border bg-background text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const StatusIcon = status === "completed" ? Check : status === "blocked" || status === "failed" ? AlertCircle
    : status === "running" || status === "active" ? Activity : status === "cancelled" ? X : Clock3;
  return <Badge variant="outline" className={cn("gap-1.5 px-2 py-1 text-xs", statusClasses[status], className)}>
    <StatusIcon className="size-3" aria-hidden="true"/>{statusLabels[status]}
  </Badge>;
}

export function AgentAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return <Avatar className={small ? "size-6" : "size-8"} aria-hidden="true">
    <AvatarFallback className={small ? "text-xs" : "text-sm"}>{Array.from(name)[0]?.toUpperCase() ?? "A"}</AvatarFallback>
  </Avatar>;
}

const relative = new Intl.RelativeTimeFormat("it", { numeric: "auto" });
export function ago(value: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  if (seconds < 60) return "adesso";
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), "hour");
  return relative.format(-Math.floor(seconds / 86400), "day");
}

export function UpdatedTime({ value, now }: { value: number; now: number }) {
  return <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(value).toISOString()}
    title={new Date(value).toLocaleString("it")}>{ago(value, now)}</time>;
}

export function ErrorNotice({ message, retry }: { message: string; retry: () => void }) {
  return <Alert variant="destructive" className="relative pr-24">
    <AlertCircle aria-hidden="true"/><AlertTitle>Aggiornamento non disponibile</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
    <div className="absolute top-3 right-3"><Button variant="outline" size="sm" onClick={retry}><RefreshCw aria-hidden="true"/>Riprova</Button></div>
  </Alert>;
}

export function LoadingCards({ count = 1, label = "Caricamento delle attività…" }: { count?: number; label?: string }) {
  return <div role="status" aria-label={label} className="grid gap-4">
    <span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, index) => <Card key={index} aria-hidden="true">
      <CardHeader className="gap-3"><Skeleton className="h-5 w-24"/><Skeleton className="h-6 w-3/4"/></CardHeader>
      <CardContent className="space-y-2"><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-2/3"/></CardContent>
    </Card>)}
  </div>;
}
