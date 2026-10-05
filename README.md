# AOVerview

Dashboard locale del lavoro degli agent, alimentata tramite MCP. Mostra obiettivi, attività a blocchi, risultati, problemi, prossimi passi provvisori e contributi dei subagent, senza ricostruire la conversazione con ulteriori chiamate al modello.

Ogni agent principale avvia una sessione indipendente. La dashboard mostra più sessioni insieme e permette di esplorare i subagent di ciascuna. Lo stato è dichiarato dagli agent: il silenzio non viene interpretato come completamento o fallimento.

## Avvio

Richiede **Node.js 24+** e npm.

```bash
npm ci
npm run dev
```

Apri **http://localhost:3000**. Il comando compila il core, esegue le migrazioni e avvia i tre servizi con aggiornamento automatico del codice. Alla chiusura termina anche i processi figli.

| Servizio | Indirizzo predefinito |
| --- | --- |
| Dashboard React | `http://localhost:3000` |
| MCP HTTP | `http://localhost:3001/mcp` |
| API di lettura | `http://localhost:3002/api/v1` |
| Disponibilità API | `http://localhost:3002/health` |

Il precedente `hello-world` è sostituito dai quattro tool di reporting. L'endpoint MCP passa dalla porta 3000 alla **3001**.

Per la versione compilata:

```bash
npm run build
npm start
```

La dashboard compilata viene servita dal proprio processo Node, con lo stesso inoltro `/api` usato da Vite in sviluppo.

La UI usa **shadcn/ui New York**, Radix, Tailwind CSS 4 e Lucide, con tema scuro e sidebar inset. I componenti sono in `apps/dashboard/src/components/ui`; la configurazione per aggiungerne altri è in `apps/dashboard/components.json`.

## Collegare un agent

Nei client MCP con configurazione HTTP tramite `url`:

```json
{
  "mcpServers": {
    "aoverview": { "url": "http://localhost:3001/mcp" }
  }
}
```

Fornisci all'agent la [skill AOVerview](skills/aoverview/SKILL.md). Il file è distribuibile e non viene installato automaticamente nel catalogo globale. Puoi farlo leggere all'agent o installarlo nel sistema di skill che usi; per il catalogo centrale usa SkillGesture.

| Tool | Utilizzo |
| --- | --- |
| `overview_open` | Apre una sessione con titolo, nome dell'agent e pochi obiettivi. Il `requestId` di apertura deve essere globalmente unico. |
| `overview_update` | Comunica solo le modifiche significative, raggruppando operazioni correlate. |
| `overview_register_subagent` | Riserva l'identità di un figlio prima dello spawn. |
| `overview_resume` | Recupera contesto compatto e revisione dopo perdita del contesto o conflitti. |

Conserva handle e revisione restituiti anche nei riepiloghi di compattazione/ripresa. Le risposte di scrittura non ripetono i testi inviati; il risultato è in `structuredContent`. Gli errori sono risposte MCP `isError` con codice e indicazione breve.

La ripresa restituisce gli ultimi tre dettagli del blocco attivo, fino a cinque blocchi bloccati/proposti e venti figli, dando priorità alle deleghe ancora aperte. La dashboard e l'API conservano la cronologia completa.

Esempio di apertura:

```json
{
  "requestId": "my-native-session-unique-id",
  "title": "Implementare la dashboard",
  "agentName": "Codex",
  "goals": [{ "id": "g1", "title": "Visualizzare progressi e risultati" }]
}
```

Esempio di aggiornamento dopo l'apertura con revisione 0:

```json
{
  "handle": "HANDLE_RESTITUITO_DAL_SERVER",
  "requestId": "start-1",
  "expectedRevision": 0,
  "operations": [
    { "op": "goal", "id": "g1", "status": "active" },
    {
      "op": "block", "id": "b1", "title": "Definire il modello dei dati",
      "status": "active", "goalId": "g1",
      "details": [{ "id": "d1", "action": "Chiarite le informazioni da mostrare", "result": "Separati obiettivi, attività e proposte" }]
    },
    { "op": "block", "id": "b2", "title": "Implementare la persistenza", "status": "proposed" }
  ]
}
```

## Regole del reporting

- Un solo blocco `active` per agent; altri possono restare `blocked`. I nuovi blocchi sono `proposed` o `active`.
- Le proposte sono modificabili; l'attivazione conferma l'avvio. Non possono contenere passaggi già svolti.
- Il lavoro attivo può diventare `blocked`, `completed`, `failed` o `cancelled`. Quello bloccato può riprendere; gli stati terminali non riaprono.
- Campi omessi conservano il valore; `null` cancella un valore opzionale. I dettagli sono aggiunti/corretti per ID, senza sostituire la lista completa.
- Le chiavi brevi dei blocchi appartengono all'agent e quelle dei dettagli al blocco: due agent possono usare `b1` senza sovrascriversi. Solo il principale gestisce gli obiettivi della sessione.
- Ogni nuova richiesta ha un nuovo `requestId`. Un retry identico riusa tutti gli argomenti originali. Il riuso con contenuto diverso è rifiutato.
- Ogni batch è atomico, compresa la notifica alla dashboard. Le revisioni sono per agent: i figli non invalidano quelle dei genitori.
- Per `REVISION_CONFLICT`, riprendi il contesto prima di preparare un aggiornamento corretto.

Prima dello spawn, registra il subagent dal blocco attivo del genitore. Passa al figlio handle, identità e skill nel messaggio di avvio. Il primo aggiornamento del figlio conferma l'esecuzione. Se lo spawn fallisce, annulla la riserva con un'operazione `delegation`.

Quando utilizzi realmente un contributo concluso, registra `delegation` con `status: "integrated"` e il tuo `blockId`. Completamento e integrazione restano distinti. Lo stesso flusso supporta deleghe annidate.

Per concludere con successo, chiudi i blocchi attivi/bloccati, attendi i discendenti e completa o annulla gli obiettivi. L'operazione `finish` registra l'esito e annulla le proposte rimaste. Un fallimento del genitore non viene propagato automaticamente ai figli.

## API e aggiornamenti live

API esclusivamente di lettura; non espone handle di scrittura o ricevute interne.

| Endpoint | Dati |
| --- | --- |
| `GET /api/v1/sessions` | Sessioni e attività correnti |
| `GET /api/v1/sessions/:id` | Obiettivi e gerarchia degli agent |
| `GET /api/v1/agents/:agentId/blocks` | Blocchi senza dettagli completi |
| `GET /api/v1/agents/:agentId/blocks/:blockId` | Blocco e passaggi svolti |
| `GET /api/v1/events` | Notifiche SSE |

Le liste accettano `limit` (1–100, predefinito 30) e il `cursor` restituito dalla pagina precedente. Per i blocchi, `view=history` mostra il lavoro avviato dalla fase più recente; `view=proposed` mostra le proposte. Senza filtro sono restituiti tutti i blocchi in ordine di avvio/creazione, incluse le proposte annullate.

L'API effettua un solo polling del registro persistente ogni 500 ms, indipendentemente dal numero di browser. Le notifiche SSE contengono sequenza, sessione e agent; la dashboard recupera le viste interessate. Le riconnessioni recuperano uno snapshot aggiornato; `Last-Event-ID` permette replay limitato o reset per backlog lunghi.

```bash
curl http://localhost:3002/api/v1/sessions
```

## Configurazione e servizi indipendenti

Copia `.env.example` in `.env` per cambiare porte e archivio. I percorsi relativi del database vengono risolti dalla root del monorepo anche avviando un singolo workspace.

```dotenv
AOVERVIEW_DB_PATH=./data/aoverview.sqlite
AOVERVIEW_MCP_PORT=3001
AOVERVIEW_API_PORT=3002
AOVERVIEW_DASHBOARD_PORT=3000
```

Prima di avviare i singoli servizi:

```bash
npm run db:migrate
npm run dev -w @aoverview/mcp
npm run dev -w @aoverview/api
npm run dev -w @aoverview/dashboard
```

Esegui gli ultimi tre comandi in terminali distinti. Per i servizi compilati usa `start`, dopo `npm run build`.

SQLite usa WAL, foreign key e timeout dei lock. MCP scrive; API ha una connessione in sola lettura. Le migrazioni sono versionate e idempotenti.

## Verifica

```bash
npm run typecheck
npm test
npm run build
```

I test usano database temporanei e coprono atomicità, isolamento, retry, stati, deleghe annidate, ripresa, paginazione, concorrenza multiprocesso, API/SSE, client MCP reali e avvio/spegnimento del launcher.

La prima versione è personale e locale, senza login o accesso remoto. Non registra conversazioni o log grezzi: invia contenuti adatti alla dashboard. Le UI MCP Apps potranno riutilizzare in seguito modello e API.
