# CLAUDE.md — @volcanicminds/tools

> Pacchetto npm `@volcanicminds/tools` (v0.2.x). Libreria di utility **tree-shakeable** per
> l'ecosistema Volcanic Minds (vedi mappa nel CLAUDE.md di `volcanic-backend`). È il pacchetto
> **più giovane e meno maturo** dei tre: nessuna CI, API ancora in `0.x`, e una rete di prove
> parziale (12 spec, nessuna copertura misurata).

## Stack & convenzioni

- **Node >= 26**, **ESM puro** (`NodeNext`), import con estensione `.js`. Sorgente in `lib/`, entry `index.ts`, build `tsc` → `dist/`.
- **Tree-shaking via subpath exports** — è il vincolo architetturale n.1: ogni modulo è importabile in isolamento e **non deve accoppiarsi** agli altri.

## Comandi

```bash
npm run build        # tsc -> dist/
npm run type-check   # tsc --noEmit
npm run lint         # eslint .  (lint:fix)
npm run check-all    # lint + type-check  <-- prima di committare
npm test             # mocha su test/unit/*.spec.ts (12 file)
# NB: nessuna CI: `npm test` lo lanciano solo la mano e `prepublishOnly` (check-all, test, build).
```

**Cosa le prove non toccano**, verificato il 3 ottobre 2026: nessuno spec importa
`lib/ai/index.ts` (lo carica solo la fixture della telemetria, in un processo a parte) né
`lib/ai/types.ts`, che contiene solo tipi. Le dodici batterie coprono mfa, mailer, embeddings, model,
provider, agent, la telemetria AI, vector-store, concurrency, storage, transfer e logger: i due moduli che toccano dati altrui erano anche i due senza rete, e
la prova su transfer ha trovato subito un difetto (l'evento `POST_CREATE` consegnava l'URL al
posto dell'upload). `lib/main.ts` era uno stub senza uso ed è stato rimosso. Se un giorno
si misura la copertura, va misurata con il backend monocart di `c8` per lo stesso motivo scritto
in `volcanic-backend/COVERAGE.md`: sotto `tsx` c8 semplice legge male un modulo compilato due
volte.

## Moduli & subpath (export in `package.json`)

| Import | Modulo | Cosa fa | Dipendenze |
|---|---|---|---|
| `@volcanicminds/tools/mfa` | `lib/mfa` | TOTP, secret, QR code | `otpauth`, `qrcode` |
| `@volcanicminds/tools/mailer` | `lib/mailer` | Wrapper nodemailer, HTML→text auto | `nodemailer` |
| `@volcanicminds/tools/logger` | `lib/util/logger` | Wrapper Pino (usa `global.log` se presente) | — |
| `@volcanicminds/tools/storage` | `lib/storage` | Client S3/Minio (upload, presigned URL) | `minio`, `@aws-sdk/client-s3` |
| `@volcanicminds/tools/transfer` | `lib/transfer` | Upload resumable TUS.io (local/s3) | `@tus/server`, `@tus/file-store`, `@tus/s3-store` |
| `@volcanicminds/tools/ai` | `lib/ai` | Factory model/agent multi-provider | **peer** opzionali `ai` 7, provider, `@ai-sdk/otel` |

## Modulo AI (il più nuovo, attenzione)

Cablaggio dell'**AI SDK 7**. API: `createModel(config?)`, `createAgent(config)` (restituisce il `ToolLoopAgent` dell'SDK così com'è), `ConcurrencyGuard`.
- **Peer dependencies opzionali**: `ai` 7 e il provider SDK 4 vanno installati a parte (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/mistral`, `ai-sdk-ollama`). I provider li crea `lib/ai/provider.ts`, sempre con la factory `create*`: le istanze di default leggono la propria variabile d'ambiente e ignorano la chiave configurata.
- **Fallback da env**: `AI_PROVIDER` + `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`OLLAMA_BASE_URL` + `*_MODEL`.
- **ConcurrencyGuard** obbligatorio per limitare richieste concorrenti per provider (limiti default: openai 5, mistral 10, google 10, anthropic 5, ollama 2 — vedi `docs/limits.md`).
- **Telemetria** (`lib/ai/telemetry.ts`): la prima chiamata del modulo registra l'integrazione OpenTelemetry dell'AI SDK, una volta per processo, se `@ai-sdk/otel` è installato (peer opzionale) e `AI_TELEMETRY` non è `false`; se l'applicazione ne ha già registrata una, non ne aggiunge un'altra. Il contenuto (prompt, risposte, argomenti dei tool, testi da vettorizzare) resta fuori dalle span salvo `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`; vince l'impostazione della singola chiamata. Il default lo applica un proxy sull'integrazione, quindi vale anche per le chiamate dirette all'SDK.
- File: `lib/ai/provider.ts`, `lib/ai/model.ts`, `lib/ai/agent.ts`, `lib/ai/embeddings.ts`, `lib/ai/telemetry.ts`, `lib/ai/concurrency.ts`, `lib/ai/types.ts`.
- La registrazione è per processo e non si azzera: i suoi test lanciano ogni scenario in un processo nuovo (`test/fixtures/ai-telemetry.ts`), con le span raccolte in memoria.
- Sotto mocha gli spec si caricano con `require()`: con tsx gli import statici di `ai` nello spec sono una copia CommonJS, diversa dall'`import()` dinamico della lib. Per confronti di identità (`instanceof`) nei test, prendere la classe con `await import('ai')`.

> Nota AI: quando si lavora su questo modulo, i modelli Claude più recenti sono Opus/Sonnet/Haiku 4.x e Fable 5 — non hardcodare vecchi id (es. `claude-3-5-sonnet`) presi dal README come default.

## Paradigmi (da `llms.txt`)

1. **Tree-shakeable**: import indipendenti, nessun accoppiamento tra moduli.
2. **Configuration injection**: i moduli preferiscono un config object in init invece di leggere `process.env` direttamente (eccezione: fallback espliciti del modulo AI).
3. **ESM only**: estensioni `.js` negli import.

## Limiti hardcoded (`docs/limits.md`)

Transfer S3 `partSize` 8MB (min 5MB), `maxSize` illimitato; MFA `window`=1 (±30s); Storage `region` `us-east-1`, presigned URL expiry 24h.

## File chiave

`index.ts` (re-export namespace), `lib/main.ts`, e le cartelle `lib/{ai,mailer,mfa,storage,transfer}`. Doc: `README.md`, `llms.txt`, `docs/limits.md`.
