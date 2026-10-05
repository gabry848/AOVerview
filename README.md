# AOVerview

Base TypeScript per un progetto con API, server MCP e visualizzazione dei dati in una dashboard web. Il setup iniziale include un tool MCP `hello-world` e una rotta HTTP di esempio; React e Vite sono installati per sviluppare in seguito la dashboard e le UI negli agenti tramite MCP Apps di mcp-use.

## Sviluppo

Richiede Node.js >= 22.22.2 e npm.

```bash
npm ci
npm run dev
```

Il server ascolta su `127.0.0.1:3000`. Per cambiare porta:

```bash
PORT=3001 npm run dev
```

- Endpoint MCP (HTTP): `http://localhost:3000/mcp`
- API di esempio: `http://localhost:3000/api/hello`
- Tool `hello-world`: senza argomenti restituisce `Hello world!`; con `{ "name": "Gabry" }` restituisce `Hello Gabry!`, come testo e JSON strutturato.

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello world!"}
```

Nei client MCP che supportano una configurazione HTTP tramite `url`:

```json
{
  "mcpServers": {
    "aoverview": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Verifica e build

```bash
npm run typecheck
npm run build
npm start
```

`src/server.ts` registra il tool MCP e la rotta API; `src/index.ts` avvia il server. La dashboard e le viste MCP Apps saranno sviluppate successivamente.

Riferimenti: [server mcp-use](https://docs.mcp-use.com/typescript/server) e [MCP Apps](https://docs.mcp-use.com/typescript/mcp-apps).
