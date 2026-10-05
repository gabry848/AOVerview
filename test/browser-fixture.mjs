// Isolated data for a reproducible visual/live browser check; never uses the user's database.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { migrateDatabase, OverviewStore } from "@aoverview/core";

const path = process.argv[2];
if (!path || !path.includes("aoverview-browser-qa")) throw new Error("Expected an isolated aoverview-browser-qa database path.");
migrateDatabase(path);
const store = new OverviewStore(path);
function report(writer, operations) {
  const result = store.update({ handle: writer.handle, expectedRevision: writer.revision, requestId: randomUUID(), operations });
  writer.revision = result.revision;
}
function child(writer, name, mandate, blockId) {
  const result = store.registerSubagent({ handle: writer.handle, expectedRevision: writer.revision,
    requestId: randomUUID(), name, mandate, blockId });
  writer.revision = result.revision; return result.child;
}
try {
  const secondary = store.open({ requestId: randomUUID(), title: "Riorganizzare il catalogo delle skill", agentName: "Pi", goals: [{ id: "g1", title: "Rendere le skill più facili da trovare" }] });
  report(secondary, [
    { op: "goal", id: "g1", status: "blocked" },
    { op: "block", id: "b1", title: "Chiarire i criteri di classificazione", status: "active", goalId: "g1" },
    { op: "block", id: "b1", status: "blocked", concern: "Manca una decisione sui gruppi da mantenere nel catalogo." },
  ]);
  const completed = store.open({ requestId: randomUUID(), title: "Verificare lo storage locale", agentName: "Codex", goals: [{ id: "g1", title: "Conservare i progressi dopo un riavvio" }] });
  report(completed, [
    { op: "block", id: "b1", title: "Verificare persistenza e ripresa", status: "active", goalId: "g1" },
    { op: "block", id: "b1", status: "completed", outcome: "I progressi sono disponibili anche dopo la riapertura del database." },
    { op: "goal", id: "g1", status: "completed" }, { op: "finish", status: "completed" },
  ]);
  const root = store.open({ requestId: randomUUID(), title: "Implementare la dashboard degli agent", agentName: "Codex", goals: [
    { id: "g1", title: "Definire il modello del lavoro", description: "Separare obiettivi, attività e intenzioni future." },
    { id: "g2", title: "Collegare i servizi", description: "Rendere i progressi disponibili in tempo reale." },
    { id: "g3", title: "Verificare l’esperienza utente", description: "Controllare chiarezza, ripresa e uso su mobile." },
  ] });
  report(root, [
    { op: "block", id: "b1", title: "Definire un linguaggio comune per il lavoro", status: "active", goalId: "g1",
      summary: "Un modello condiviso collega il piano dell’agent a ciò che l’utente vede.", details: [
        { id: "d1", action: "Separati gli obiettivi dai blocchi di attività", result: "Un obiettivo può attraversare più fasi senza essere duplicato.", reference: "packages/core/src/contracts.ts" },
        { id: "d2", action: "Distinte le intenzioni dai risultati", result: "I prossimi passi restano provvisori fino all’avvio." },
      ] },
    { op: "block", id: "b1", status: "completed", outcome: "Ogni agent può descrivere il proprio lavoro senza sovrascrivere gli altri." },
    { op: "goal", id: "g1", status: "completed" }, { op: "goal", id: "g2", status: "active" },
    { op: "block", id: "b2", title: "Collegare MCP, API e dashboard", status: "active", goalId: "g2",
      summary: "Gli aggiornamenti attraversano i servizi separati e arrivano alla dashboard senza ricaricare la pagina.", details: [
        { id: "d1", action: "Collegato il reporting al database condiviso", result: "Gli aggiornamenti vengono salvati insieme alla loro notifica.", reference: "packages/core/src/store.ts · test/core.test.ts" },
        { id: "d2", action: "Verificato l’isolamento tra sessioni", result: "Più agent mantengono revisioni e blocchi indipendenti." },
      ] },
    { op: "block", id: "b3", title: "Provare la dashboard su mobile", status: "proposed", goalId: "g3", summary: "Controllare che obiettivi e attività restino leggibili su uno schermo stretto." },
    { op: "block", id: "b4", title: "Verificare la ripresa dopo una disconnessione", status: "proposed", goalId: "g3" },
  ]);
  const reviewer = child(root, "Verifica API", "Controllare contratti, isolamento e notifiche live tra i servizi.", "b2");
  report(reviewer, [
    { op: "block", id: "b1", title: "Verificare il flusso di reporting", status: "active", details: [{ id: "d1", action: "Provato il contratto tra MCP e API", result: "Gli aggiornamenti sono leggibili e isolati." }] },
    { op: "block", id: "b1", status: "completed", outcome: "Il contratto è coerente tra i servizi." }, { op: "finish", status: "completed" },
  ]);
  report(root, [{ op: "delegation", childAgentId: reviewer.agentId, status: "integrated", blockId: "b2", note: "La verifica conferma il contratto usato dalla dashboard." }]);
  const ui = child(root, "Verifica interfaccia", "Controllare la leggibilità della timeline e dei contributi delegati.", "b2");
  report(ui, [{ op: "block", id: "b1", title: "Controllare timeline e dettagli", status: "active", details: [{ id: "d1", action: "Controllata la distinzione tra attività e proposte", result: "Le intenzioni future sono indicate come da confermare." }] }]);
  child(ui, "Accessibilità", "Verificare navigazione da tastiera e leggibilità degli stati.", "b1");
  writeFileSync(`${path}.identity.json`, JSON.stringify(root));
  console.log("Isolated browser fixture ready: three sessions and nested subagents.");
} finally { store.close(); }
