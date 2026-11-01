# CLAUDE.md — @volcanicminds/tools

> Pacchetto npm `@volcanicminds/tools` (v5.0.0, branch `v5`). Libreria di utility **tree-shakeable**
> per l'ecosistema Volcanic Minds (vedi mappa nel CLAUDE.md di `volcanic-backend`). Rete di prove:
> 13 spec, nessuna copertura misurata.

## Convenzioni

- **Tree-shaking via subpath exports**, il vincolo architetturale n.1: ogni modulo è importabile in isolamento e **non deve accoppiarsi** agli altri.
- **Configuration injection**: i moduli preferiscono un config object in init invece di leggere `process.env` direttamente (eccezione: fallback espliciti del modulo AI).
- Prima di committare: `npm run check-all`.
- Se un giorno si misura la copertura, va misurata con il backend monocart di `c8` per lo stesso motivo scritto in `volcanic-backend/COVERAGE.md`: sotto `tsx` c8 semplice legge male un modulo compilato due volte.

## Modulo AI (il più nuovo, attenzione)

Cablaggio dell'**AI SDK 7**.
- **Peer dependencies opzionali**: `ai` 7 e il provider SDK 4 vanno installati a parte (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/mistral`, `ai-sdk-ollama`). I provider li crea `lib/ai/provider.ts`, sempre con la factory `create*`: le istanze di default leggono la propria variabile d'ambiente e ignorano la chiave configurata.
- **Fallback da env**: `AI_PROVIDER` + `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`OLLAMA_BASE_URL` + `*_MODEL`.
- **ConcurrencyGuard** obbligatorio per limitare richieste concorrenti per provider (limiti di default in `docs/limits.md`).
- **Telemetria** (`lib/ai/telemetry.ts`): la prima chiamata del modulo registra l'integrazione OpenTelemetry dell'AI SDK, una volta per processo, se `@ai-sdk/otel` è installato (peer opzionale) e `AI_TELEMETRY` non è `false`; se l'applicazione ne ha già registrata una, non ne aggiunge un'altra. Il contenuto (prompt, risposte, argomenti dei tool, testi da vettorizzare) resta fuori dalle span salvo `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`; vince l'impostazione della singola chiamata. Il default lo applica un proxy sull'integrazione, quindi vale anche per le chiamate dirette all'SDK.
- **Tool** (`lib/ai/tool.ts`, contratto senza import a runtime; `lib/ai/tool-set.ts` per l'AI SDK; `lib/mcp/index.ts` per MCP): un tool definito una volta con `defineTool`, servito da `toAiTools` e da `createMcpHandler` con lo stesso risultato e lo stesso errore, perché passano entrambi da `runTool` e `bindCaller`. Lo schema d'ingresso è Standard Schema più Standard JSON Schema: Zod 4.2 o successivo, non Zod 3; `zod` resta devDependency, lo porta il consumer. Il chiamante va per chiamata (`toolsContext` con `generateText`, `options: { caller }` con l'agente di `createAgent`, che scrive lui `prepareCall`; `AsyncLocalStorage` in MCP), mai sul tool set né sull'agente. `ToolError` si riconosce da un brand `Symbol.for`, non da `instanceof`, perché un'app può caricare due copie del pacchetto. Il server MCP controlla l'header `Origin` contro `allowedOrigins` (obbligatorio, origini esatte): la specifica lo chiede al server e l'SDK, di proposito, non lo fa. Il backend non sa niente di MCP (F73).
- La registrazione è per processo e non si azzera: i suoi test lanciano ogni scenario in un processo nuovo (`test/fixtures/ai-telemetry.ts`), con le span raccolte in memoria.
- Sotto mocha gli spec si caricano con `require()`: con tsx gli import statici di `ai` nello spec sono una copia CommonJS, diversa dall'`import()` dinamico della lib. Per confronti di identità (`instanceof`) nei test, prendere la classe con `await import('ai')`.

> Nota AI: quando si lavora su questo modulo, i modelli Claude più recenti, al 19 ottobre 2026, sono la famiglia 5 (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`); non hardcodare come default i vecchi id degli esempi del README (es. `claude-3-5-sonnet-20240620`).

## Documentazione

`README.md`, `llms.txt` (riferimento completo di ogni entry point), `docs/limits.md` (limiti hardcoded).
