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

- Node.js >= 24.x
- ESM project (`"type": "module"`)

## How to upgrade packages

```bash
npm run upgrade-deps
```

## Usage

This package supports both root imports and sub-path imports to optimize bundle size and tree-shaking.

### Import specific features (Recommended)

```typescript
import * as mfa from '@volcanicminds/tools/mfa'
import { Mailer } from '@volcanicminds/tools/mailer'
import * as logger from '@volcanicminds/tools/logger'
import { StorageManager } from '@volcanicminds/tools/storage'
import { TransferManager } from '@volcanicminds/tools/transfer'
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

### AI Module (New)

The AI module provides a standardized way to create AI models and agents, wrapping the Vercel AI SDK and Mastra.

**Features:**

- **Unified Model Factory:** Create models with `createModel` supporting OpenAI, Mistral, Ollama, Anthropic, Google.
- **Environment Variable Fallback:** Automatically uses `AI_PROVIDER`, `OPENAI_API_KEY`, etc. if no config is provided.
- **Mastra Agent Wrapper:** `createAgent` simplifies Mastra agent creation with Volcanic configuration.
- **Concurrency Guard:** Manage concurrent AI requests per provider to avoid rate limits.

**Usage:**

```typescript
import { createModel, createAgent, ConcurrencyGuard } from '@volcanicminds/tools/ai'

// 1. Create a Model (uses Env vars by default)
const model = await createModel()

// 2. Create an Agent
const agent = await createAgent({
  name: 'Auditor',
  instructions: 'You are an auditor...',
  model: model // or config object
})

// 3. Concurrency Control
const guard = new ConcurrencyGuard()
await guard.run('openai', async () => {
  // critical section
})
```

**Installation:**

You must install the peer dependencies:

```bash
npm install ai @mastra/core
```

And the provider SDKs you need.

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
