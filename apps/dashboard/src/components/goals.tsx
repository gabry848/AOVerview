import { Circle, CircleCheck, CircleDot, CircleX, OctagonAlert, Target } from "lucide-react";
import type { Goal } from "@aoverview/core/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { statusLabels } from "./overview-ui";
import { cn } from "@/lib/utils";

export function Goals({ goals }: { goals: Goal[] }) {
  const completed = goals.filter(goal => goal.status === "completed").length;
  return <Card className="gap-5 py-5">
    <CardHeader className="gap-2 px-5">
      <CardTitle><h2 className="flex items-center gap-2"><Target className="size-4 text-muted-foreground" aria-hidden="true"/>Obiettivi</h2></CardTitle>
    </CardHeader>
    <CardContent className="px-5">
      {goals.length > 0 && <div className="mb-6 space-y-3">
        <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"><span>Completati</span>
          <span><strong className="text-lg font-semibold text-foreground">{completed}</strong> / {goals.length}</span>
        </div>
        <Progress value={completed / goals.length * 100} aria-label="Obiettivi completati" className="h-1.5"/>
      </div>}
      <ol className="space-y-5">
        {goals.map(goal => {
          const GoalIcon = goal.status === "completed" ? CircleCheck : goal.status === "active" ? CircleDot
            : goal.status === "blocked" ? OctagonAlert : goal.status === "cancelled" ? CircleX : Circle;
          return <li key={goal.id} className="flex gap-3">
            <GoalIcon className={cn("mt-0.5 size-4 shrink-0", goal.status === "active" ? "text-emerald-400"
              : goal.status === "blocked" ? "text-amber-400" : "text-muted-foreground")} aria-hidden="true"/>
            <div className="min-w-0">
              <h3 className={cn("wrap-anywhere text-sm leading-5 font-medium", goal.status === "cancelled" && "line-through text-muted-foreground")}>{goal.title}</h3>
              {goal.description && <p className="mt-1.5 wrap-anywhere text-xs leading-5 text-muted-foreground">{goal.description}</p>}
              <p className="mt-1.5 text-[11px] text-muted-foreground">{statusLabels[goal.status]}</p>
            </div>
          </li>;
        })}
      </ol>
      {goals.length === 0 && <p className="text-sm leading-6 text-muted-foreground">L’agent non ha ancora definito gli obiettivi.</p>}
    </CardContent>
  </Card>;
}
