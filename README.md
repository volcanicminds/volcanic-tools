[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-typeorm](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-typeorm)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/tools)

# volcanic-tools

Tools for the volcanic (minds) backend. This library provides a collection of modular utilities designed to be tree-shakeable.

## Installation

```bash
npm install @volcanicminds/tools
```

## Requirements

- Node.js >= 26.x
- ESM project (`"type": "module"`)

## How to upgrade packages

```bash
npm run upgrade-deps
```

## Documentation

For detailed information about hardcoded limits, default configuration values (e.g., AI concurrency, chunk sizes, token window), and advanced setup, please refer to the [`docs/`](./docs) folder:
- [Configuration & Limits](./docs/limits.md)

## Usage

This package supports both root imports and sub-path imports to optimize bundle size and tree-shaking.

### Import specific features (Recommended)

```typescript
import * as mfa from '@volcanicminds/tools/mfa'
import { Mailer } from '@volcanicminds/tools/mailer'
import * as logger from '@volcanicminds/tools/logger'
import { StorageManager } from '@volcanicminds/tools/storage'
import { TransferManager } from '@volcanicminds/tools/transfer'
import { createEmbedder, embedText, PgVectorStore } from '@volcanicminds/tools/ai'
```

---

## Features

### MFA (Multi-Factor Authentication)

Utilities for generating secrets, QR codes, and verifying TOTP tokens based on `otpauth`.

```typescript
import * as mfa from '@volcanicminds/tools/mfa'

// 1. Generate a generic base32 secret (Optional, useful if you need to store it before setup)
const secret = mfa.generateSecret()

// 2. Generate Setup Details for the User (returns secret, otpauth URI, and QR Code Data URL)
// If secret is omitted, a new one is generated automatically.
const setup = await mfa.generateSetupDetails('MyApp', 'user@example.com', secret)

console.log(setup.secret) // Save this to DB
console.log(setup.qrCode) // Send this to Frontend to display QR

// 3. Verify a Token provided by the user
const userToken = '123456' // From input
const isValid = mfa.verifyToken(userToken, setup.secret)

if (isValid) {
  // Proceed with login/action
}

// 4. Generate a valid token (Useful for testing or recovery codes)
const currentToken = mfa.generateToken(setup.secret)
```

---

### Mailer

A wrapper around `nodemailer` designed for simplicity and configuration injection. It automatically handles HTML-to-Text conversion if the text body is missing.

#### Configuration & Initialization

```typescript
import { Mailer } from '@volcanicminds/tools/mailer'

// Initialize with a config object (not bound to process.env)
const mailer = new Mailer({
  host: 'smtp.example.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: 'my-user',
    pass: 'my-password'
  },
  defaultFrom: '"My Service" <noreply@example.com>', // Optional: used if not specified in send()
  defaultReplyTo: 'support@example.com' // Optional
})

// Optional: Verify connection on startup
const isConnected = await mailer.verifyConnection()
if (isConnected) console.log('SMTP Ready')
```

#### Sending Emails

```typescript
try {
  const info = await mailer.send({
    // Optional if defaultFrom is set in config, otherwise Mandatory
    from: '"Support Team" <support@example.com>',

    to: 'user@destination.com', // Can be a string or array of strings
    cc: ['manager@destination.com'],
    subject: 'Welcome to Volcanic Tools',

    // Text version is automatically generated from HTML if omitted,
    // converting <br> to newlines and stripping tags.
    text: 'Hello, World! Welcome aboard.',
    html: '<p>Hello, <strong>World</strong>!<br/>Welcome aboard.</p>',

    attachments: [
      {
        filename: 'license.txt',
        content: 'MIT License...'
      }
    ]
  })

  console.log('Message sent: %s', info.messageId)
} catch (error) {
  console.error('Error sending email:', error)
}
```

---

### Logging

Use Pino logger wrapper if in your project you have a `global.log` with a valid instance.

```typescript
import * as log from '@volcanicminds/tools/logger'

log.info('Application started')
log.error({ err: new Error('Oops') }, 'Something went wrong')
```

---

### Storage (S3 / Minio)

A robust wrapper around the `minio` client to handle file operations on S3-compatible storage.

```typescript
import { StorageManager } from '@volcanicminds/tools/storage'

const storage = new StorageManager({
  endPoint: 'minio.example.com',
  port: 9000,
  useSSL: true,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucket: 'my-bucket',
  region: 'us-east-1'
})

// Check connection
const isConnected = await storage.verifyConnection() // true/false

// Upload a file (Stream, Buffer, or Path)
const info = await storage.uploadFile('folder/image.png', fileBuffer, {
  contentType: 'image/png',
  metadata: { userId: '123' }
})
console.log('ETag:', info.etag)

// Generate Presigned URLs (for frontend direct access)
const downloadUrl = await storage.getFileUrl('folder/image.png', 3600) // Expires in 1h
const uploadUrl = await storage.getUploadUrl('folder/new-image.png', 3600)

// Check existence
const exists = await storage.fileExists('folder/image.png')

// Delete
await storage.deleteFile('folder/image.png')
```

---

### Transfer (Resumable Uploads - Tus.io)

A wrapper around `@tus/server` to implement resumable file uploads (standard protocol). Supports both local filesystem and S3 backends.

#### Initialization

```typescript
import { TransferManager } from '@volcanicminds/tools/transfer'

const transfer = new TransferManager({
  driver: 'local', // or 's3'
  path: '/files', // The HTTP endpoint path (e.g. http://localhost:3000/files)
  maxSize: 10 * 1024 * 1024 * 1024, // 10 GB

  // If driver is 'local'
  local: {
    directory: './uploads'
  },

  // If driver is 's3'
  s3: {
    bucket: 'uploads',
    endPoint: 'minio.example.com',
    accessKey: '...',
    secretKey: '...',
    partSize: 8 * 1024 * 1024 // 8MB chunks
  }
})
```

#### Integration with Fastify/Node Key

The `transfer` instance exposes a standard Node.js request handler (`handle`). You can use it within a Fastify route or raw Node server.

```typescript
// Fastify Example
fastify.all('/files/*', async (req, reply) => {
  // Pass the raw Node.js request/response objects to Tus
  await transfer.handle(req.raw, reply.raw)
  // Prevent Fastify from sending a response, Tus handles it
  reply.sent = true
})
```

#### Events

You can listen for upload lifecycle events:

```typescript
transfer.onUploadCreate((upload, req, res) => {
  console.log('Upload started:', upload.id)
})

transfer.onUploadFinish((upload, req, res) => {
  console.log('Upload finished:', upload.id)
})
```

### AI module

The AI module wires the [AI SDK](https://ai-sdk.dev) (version 7): models from a config or the environment, and
agents that are the SDK's own `ToolLoopAgent`.

**Features:**

- **Unified Model Factory:** Create models with `createModel` supporting OpenAI, Mistral, Ollama, Anthropic, Google.
  The configured `apiKey` and `baseUrl` win over the provider's own environment variable.
- **Environment Variable Fallback:** Automatically uses `AI_PROVIDER`, `OPENAI_API_KEY`, etc. if no config is provided.
- **Agents:** `createAgent` returns the AI SDK's `ToolLoopAgent` as it is. The model may be a config; the agent's
  `name` becomes its `id` and the `functionId` of its telemetry, so its spans are grouped by agent. Every other
  setting (`instructions`, `tools`, `stopWhen`, `prepareCall`, `telemetry`) is the SDK's, except with tools from
  `defineTool`: then the caller comes with each call (see below).
- **Tools:** `defineTool` defines a tool once, for the AI SDK (`toAiTools`) and for an MCP server
  (`@volcanicminds/tools/mcp`), acting as the person using it (see below).
- **Telemetry:** with `@ai-sdk/otel` installed, AI calls are traced over OpenTelemetry, without their content
  unless asked for (see below).
- **Concurrency Guard:** Manage concurrent AI requests per provider to avoid rate limits.
- **Embeddings:** `createEmbedder` / `embedText` / `embedTexts` produce vectors (OpenAI, Mistral, Google, Ollama), parametrizable via config or env.
- **Vector store:** `PgVectorStore`, an engine‑agnostic pgvector helper that runs identically on real Postgres and embedded PGlite.

**Usage:**

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { createModel, createAgent, ConcurrencyGuard } from '@volcanicminds/tools/ai'

// 1. Create a Model (uses Env vars by default)
const model = await createModel()

// 2. Create an Agent: the AI SDK's ToolLoopAgent
const agent = await createAgent({
  name: 'auditor',
  instructions: 'You are an auditor.',
  model, // or a config: { provider: 'openai', model: 'gpt-4o' }
  tools: {
    invoice: tool({
      description: 'An invoice by number',
      inputSchema: z.object({ number: z.string() }),
      execute: async ({ number }) => findInvoice(number)
    })
  }
})
const { text } = await agent.generate({ prompt: 'Check invoice 42' })

// 3. Concurrency Control
const guard = new ConcurrencyGuard()
await guard.run('openai', async () => {
  // critical section
})
```

**Installation:**

The AI module needs `ai` (version 7), which asks for `zod` as its own peer. Both are optional peers of this
package, so the other modules install without them:

```bash
npm install ai zod
```

And the provider SDKs you need (version 4).

_Example for OpenAI:_

```bash
npm install @ai-sdk/openai
```

_Example for Anthropic:_

```bash
npm install @ai-sdk/anthropic
```

_Example for Google (Gemini):_

```bash
npm install @ai-sdk/google
```

_Example for Ollama:_

```bash
npm install ai-sdk-ollama
```

**Telemetry (OpenTelemetry):**

Installing `@ai-sdk/otel` turns it on: the first call of this module (`createModel`, `createEmbedder`,
`createAgent`, `embedText`, `embedTexts`) registers the AI SDK's OpenTelemetry integration, once per process. The
spans go to the tracer provider already running, the one `@volcanicminds/backend` starts from the `OTEL_*`
variables for instance: one per agent run, per step, per model call and per tool call, with the agent's name in
`gen_ai.agent.name`.

```bash
npm install @ai-sdk/otel
```

| Variable | Effect | Default |
| --- | --- | --- |
| `AI_TELEMETRY` | `false` registers nothing | on, when `@ai-sdk/otel` is installed |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` records prompts, instructions, responses, tool arguments and results, embedded texts | `false` |

Content stays out of the spans by default, because prompts and responses may carry personal data. A call's own
setting wins over the variable, for one agent:

```typescript
const agent = await createAgent({ name: 'auditor', model, telemetry: { recordInputs: true } })
```

Things to know:

- The registry is process-wide: from the first call on, every AI SDK call is traced, including the ones the
  application makes directly with `generateText` or `embed`, with the same default on content. Calls made before
  it are not.
- An application that registers the integration itself (`registerTelemetry(new OpenTelemetry())` from `ai`) keeps
  it: this module adds none, so the spans do not come twice. Register it before the first call of this module,
  and the content default above no longer applies: the SDK's does, which records it.
- `@ai-sdk/otel` pins `ai` to its own exact version: with another `ai` 7 release the application gets a second
  copy of `ai` in `node_modules`. It works, because the registry lives on `globalThis`, but it weighs.

### Tools for agents and MCP

A tool is defined once with `defineTool` and served by two adapters: `toAiTools` builds an AI SDK tool set,
`createMcpHandler` (subpath `@volcanicminds/tools/mcp`) an MCP server for an external assistant. A tool
reaches the application only through `call`, its API with the credential of the person using the tool, so it sees
what that person would see. The application writes the caller per request:

```typescript
import { generateText } from 'ai'
import { z } from 'zod'
import { defineTool, toAiTools, callerContext, type ApiCaller } from '@volcanicminds/tools/ai'

const listVehicles = defineTool({
  name: 'list_vehicles',
  description: 'Vehicles on sale, newest first',
  input: z.object({ brand: z.string().optional() }),
  execute: (input, { call }) => call({ method: 'GET', path: '/vehicles', query: input.brand ? { brand: input.brand } : {} })
})
const tools = [listVehicles] as const
const aiTools = toAiTools(tools) // once, at startup: the tool set holds no identity

// Per request: the API as the person behind it, here through Fastify's inject with their own cookie.
const caller: ApiCaller = async ({ method, path, query, body }) => {
  const response = await server.inject({ method, url: path, query, payload: body as object | undefined, headers: { cookie: req.headers.cookie } })
  return { status: response.statusCode, body: response.body ? response.json() : null }
}
const { text } = await generateText({ model, tools: aiTools, toolsContext: callerContext(tools, caller), prompt })
```

A call without `toolsContext` does not compile; if it runs anyway, it throws an `AI_TypeValidationError` ("No
caller") before any tool runs, because the AI SDK validates the context of every tool.

An agent takes the same tools, and the caller as an option of each call:

```typescript
import { createAgent } from '@volcanicminds/tools/ai'

// Once, at startup: the agent holds nobody's credential.
const assistant = await createAgent({ name: 'sales', model, instructions: 'Answer about the stock.', tools })

// Per request.
const { text } = await assistant.generate({ prompt, options: { caller } })
```

`createAgent` writes the agent's `prepareCall`, which hands the caller to the tools, so a config that sets
`prepareCall`, `callOptionsSchema` or `toolsContext` is refused. A call without `options: { caller }` does not
compile; if it runs anyway, it fails before the model is called. An agent takes tools from `defineTool` (a list) or
SDK tools (a record), not both.

The same tools over MCP, mounted by the application on one of its own authenticated routes:

```typescript
import { createMcpHandler } from '@volcanicminds/tools/mcp'

const mcp = await createMcpHandler({
  name: 'sales',
  version: '1.0.0',
  tools,
  allowedOrigins: ['https://console.example.com'], // browsers; a client that sends no Origin always passes
  onError: (error, tool) => log.error({ error, tool })
})

// In the route, per request: a web-standard Request in, a Response out.
const response = await mcp.fetch(request, { caller, parsedBody: req.body })
```

Things to know:

- The input schema must be Standard Schema and Standard JSON Schema at once, which both SDKs take as it is. Zod
  4.2 or later is; Zod 3 is not. This package does not install `zod`: the application brings it.
- `call` takes an API path, never a URL; a path that names another host (`//host`, `/\host`) is refused before the
  API is called. A 2xx resolves with the body; anything else throws a `ToolCallError` whose message carries the
  API's `code` (`STEP_UP_REQUIRED: Recent authentication required`).
- Errors: the message of a `ToolError` (and `ToolCallError`) reaches the model or the MCP client as it is. Any
  other error becomes "Tool '<name>' failed", so no internal detail leaks; the original is the error's `cause` for
  the AI SDK and goes to `onError` for MCP.
- The MCP server is stateless Streamable HTTP, built on `createMcpHandler` of `@modelcontextprotocol/server` 2: a
  server per request, with the caller carried to the tools through `AsyncLocalStorage`. It checks no credential:
  the route that mounts it authenticates the request and builds the caller.
- It checks the `Origin`, which the MCP specification (2026-07-28, Streamable HTTP) asks of every server against
  DNS rebinding and the SDK leaves to whoever mounts it: an `Origin` not in `allowedOrigins` gets 403 before any
  tool runs, a request without one passes. Entries are exact origins (`scheme://host[:port]`); `*`, a path or a
  trailing slash stop the handler from being created, and an empty list admits no browser.
- `./mcp` re-exports `defineTool` and the errors, so an MCP server alone does not need `ai`.
  `@volcanicminds/backend` knows nothing about MCP.

```bash
npm install @modelcontextprotocol/server zod
```

### Embeddings & Vector Search (pgvector)

Generate embeddings and run similarity search. The vector store is **engine‑agnostic**: give it any pg‑compatible
`query` executor — a TypeORM `dataSource.query`, an embedded PGlite instance, or a node‑postgres pool — and the
same code runs on a real Postgres (with `pgvector` installed) and on PGlite (with `vector: true`). Everything is
parametrizable via config: provider/model for embeddings, table name, vector `dimensions`, and `distance`
(`cosine` | `l2` | `ip`).

```typescript
import { createEmbedder, embedText, PgVectorStore } from '@volcanicminds/tools/ai'

// 1. Embeddings — provider/model resolved from config or env
//    (AI_EMBEDDING_PROVIDER falls back to AI_PROVIDER; e.g. OPENAI_EMBEDDING_MODEL).
const vector = await embedText('hello world')               // number[]
// const embedder = await createEmbedder({ provider: 'openai', model: 'text-embedding-3-small' })

// 2. Vector store — works on Postgres or embedded PGlite unchanged
const store = new PgVectorStore({
  query: (sql, params) => dataSource.query(sql, params),     // any pg-compatible executor
  table: 'documents',
  dimensions: 1536,                                          // match your embedding model
  distance: 'cosine',
  // schema: 'tenant_a'                                      // optional, for multi-tenant isolation
})

await store.init()                                          // CREATE EXTENSION vector + table (idempotent)
await store.upsert('doc-1', 'the text', vector, { source: 'docs' })
const matches = await store.search(await embedText('a query'), 5)
//   -> [{ id, content, metadata, distance }, ...] nearest first
```

**Installation:** the store itself needs only your DB executor. For embeddings install `ai` + a provider SDK
(see below). To back it with embedded PGlite use the backend's `type: 'pglite'` engine (`vector: true`) — see
[`@volcanicminds/backend` docs/PGLITE.md](../volcanic-backend/docs/PGLITE.md).

### Advanced Model Examples

#### 1. Anthropic (Claude 3.5 Sonnet)

Configured via Environment Variables:

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20240620
```

Or explicit configuration:

```typescript
const model = await createModel({
  provider: 'anthropic',
  apiKey: 'sk-ant-...',
  model: 'claude-3-5-sonnet-20240620'
})
```

#### 2. Google (Gemini 1.5 Pro)

Configured via Environment Variables:

```bash
AI_PROVIDER=google
GOOGLE_API_KEY=AIza...
GOOGLE_MODEL=models/gemini-1.5-pro-latest
```

Or explicit configuration:

```typescript
const model = await createModel({
  provider: 'google',
  apiKey: 'AIza...',
  model: 'models/gemini-1.5-pro-latest'
})
```

#### 3. Ollama (Llama 3 Local)

Configured via Environment Variables:

```bash
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_MODEL=llama3
```

Or explicit configuration:

```typescript
const model = await createModel({
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/api',
  model: 'llama3'
})
```
