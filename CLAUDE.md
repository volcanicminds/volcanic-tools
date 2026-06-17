# CLAUDE.md — @volcanicminds/tools

> Pacchetto npm `@volcanicminds/tools` (v0.1.x). Libreria di utility **tree-shakeable** per
> l'ecosistema Volcanic Minds (vedi mappa nel CLAUDE.md di `volcanic-backend`). È il pacchetto
> **più giovane e meno maturo** dei tre: nessun test, nessuna CI, API ancora in `0.x`.

## Stack & convenzioni

- **Node >= 24**, **ESM puro** (`NodeNext`), import con estensione `.js`. Sorgente in `lib/`, entry `index.ts`, build `tsc` → `dist/`.
- **Tree-shaking via subpath exports** — è il vincolo architetturale n.1: ogni modulo è importabile in isolamento e **non deve accoppiarsi** agli altri.

## Comandi

```bash
npm run build        # tsc -> dist/
npm run type-check   # tsc --noEmit
npm run lint         # eslint .  (lint:fix)
npm run check-all    # lint + type-check  <-- prima di committare
# NB: NESSUN `npm test`. Nessuna CI. Affidarsi a check-all + verifica manuale.
```

## Moduli & subpath (export in `package.json`)

| Import | Modulo | Cosa fa | Dipendenze |
|---|---|---|---|
| `@volcanicminds/tools/mfa` | `lib/mfa` | TOTP, secret, QR code | `otpauth`, `qrcode` |
| `@volcanicminds/tools/mailer` | `lib/mailer` | Wrapper nodemailer, HTML→text auto | `nodemailer` |
| `@volcanicminds/tools/logger` | `lib/util/logger` | Wrapper Pino (usa `global.log` se presente) | — |
| `@volcanicminds/tools/storage` | `lib/storage` | Client S3/Minio (upload, presigned URL) | `minio`, `@aws-sdk/client-s3` |
| `@volcanicminds/tools/transfer` | `lib/transfer` | Upload resumable TUS.io (local/s3) | `@tus/server`, `@tus/file-store`, `@tus/s3-store` |
| `@volcanicminds/tools/ai` | `lib/ai` | Factory model/agent multi-provider | **peer** `ai`, `@mastra/core` |

## Modulo AI (il più nuovo — attenzione)

Wrappa la **Vercel AI SDK** + **Mastra**. API: `createModel(config?)`, `createAgent(config)`, `ConcurrencyGuard`.
- **Peer dependencies opzionali**: il provider SDK va installato a parte (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/mistral`, `ai-sdk-ollama`). I model sono creati dinamicamente per non caricare SDK inutilizzati.
- **Fallback da env**: `AI_PROVIDER` + `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`OLLAMA_BASE_URL` + `*_MODEL`.
- **ConcurrencyGuard** obbligatorio per limitare richieste concorrenti per provider (limiti default: openai 5, mistral 10, google 10, anthropic 5, ollama 2 — vedi `docs/limits.md`).
- File: `lib/ai/model.ts`, `lib/ai/agent.ts`, `lib/ai/concurrency.ts`, `lib/ai/types.ts`.

> Nota AI: quando si lavora su questo modulo, i modelli Claude più recenti sono Opus/Sonnet/Haiku 4.x e Fable 5 — non hardcodare vecchi id (es. `claude-3-5-sonnet`) presi dal README come default.

## Paradigmi (da `llms.txt`)

1. **Tree-shakeable**: import indipendenti, nessun accoppiamento tra moduli.
2. **Configuration injection**: i moduli preferiscono un config object in init invece di leggere `process.env` direttamente (eccezione: fallback espliciti del modulo AI).
3. **ESM only**: estensioni `.js` negli import.

## Limiti hardcoded (`docs/limits.md`)

Transfer S3 `partSize` 8MB (min 5MB), `maxSize` illimitato; MFA `window`=1 (±30s); Storage `region` `us-east-1`, presigned URL expiry 24h.

## File chiave

`index.ts` (re-export namespace), `lib/main.ts`, e le cartelle `lib/{ai,mailer,mfa,storage,transfer}`. Doc: `README.md`, `llms.txt`, `docs/limits.md`.
