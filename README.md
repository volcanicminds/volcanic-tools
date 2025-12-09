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
