# Volcanic Tools - Updated At 2025-11-26T11:45:10.329Z

Below are all the files, materials and documentation of the project to analyze.

```bash
./
├── .nvmrc
├── README.md
├── index.d.ts
├── index.ts
├── package.json
├── tsconfig.json
├── lib
    ├── feature1/index.ts
    ├── feature2/index.ts
    ├── main.ts
    ├── util/logger.ts
├── types
    ├── global.d.ts
```

## Source Files Index

- [.nvmrc](#file--nvmrc)
- [README.md](#file-README-md)
- [index.d.ts](#file-index-d-ts)
- [index.ts](#file-index-ts)
- [package.json](#file-package-json)
- [tsconfig.json](#file-tsconfig-json)
- [lib/feature1/index.ts](#file-lib-feature1-index-ts)
- [lib/feature2/index.ts](#file-lib-feature2-index-ts)
- [lib/main.ts](#file-lib-main-ts)
- [lib/util/logger.ts](#file-lib-util-logger-ts)
- [types/global.d.ts](#file-types-global-d-ts)

## File: .nvmrc

```javascript
v24.11.0

```

## File: README.md

```markdown
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

## Environment

```bash
# or automatically use LOG_LEVEL
SOME_KEY=true
```

## Usage

This package supports both root imports and sub-path imports to optimize bundle size.

### Import everything

```typescript
import { feature1, feature2 } from '@volcanicminds/tools'
```

### Import specific features (Recommended for smaller bundles)

```typescript
import { feature1 } from '@volcanicminds/tools/feature1'
import * as logger from '@volcanicminds/tools/logger'
```

## Logging

Use Pino logger if in your project you have a `global.log` with a valid instance.

```

## File: index.d.ts

```typescript
export { MyInterface } from './types/global'

```

## File: index.ts

```typescript
export * from './lib/feature1/index.js'
export * from './lib/feature2/index.js'
export * as log from './lib/util/logger.js'

```

## File: package.json

```javascript
{
  "name": "@volcanicminds/tools",
  "version": "0.0.1",
  "type": "module",
  "license": "MIT",
  "description": "Tools for the volcanic (minds) backend",
  "keywords": [
    "volcanic",
    "open source",
    "tools",
    "typescript",
    "esm"
  ],
  "main": "dist/index.js",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "sideEffects": false,
  "files": [
    "dist",
    "lib"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    },
    "./feature1": {
      "types": "./dist/lib/feature1/index.d.ts",
      "import": "./dist/lib/feature1/index.js",
      "require": "./dist/lib/feature1/index.js"
    },
    "./feature2": {
      "types": "./dist/lib/feature2/index.d.ts",
      "import": "./dist/lib/feature2/index.js",
      "require": "./dist/lib/feature2/index.js"
    },
    "./logger": {
      "types": "./dist/lib/util/logger.d.ts",
      "import": "./dist/lib/util/logger.js",
      "require": "./dist/lib/util/logger.js"
    }
  },
  "typesVersions": {
    "*": {
      "*": [
        "dist/index.d.ts"
      ],
      "feature1": [
        "dist/lib/feature1/index.d.ts"
      ],
      "feature2": [
        "dist/lib/feature2/index.d.ts"
      ],
      "logger": [
        "dist/lib/util/logger.d.ts"
      ]
    }
  },
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "clean": "rm -rf dist",
    "prebuild": "npm run clean",
    "build": "tsc",
    "reset": "npm install && npm update && npm run build",
    "upgrade-deps": "npx npm-check-updates -u",
    "combine": "node combine.js"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "tsx": "^4.19.2",
    "typescript": "^5.9.3"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/volcanicminds/volcanic-tools.git"
  },
  "homepage": "https://volcanicminds.com",
  "bugs": {
    "url": "https://github.com/volcanicminds/volcanic-tools/issues"
  },
  "author": "Volcanic Minds <developers@volcanicminds.com> (https://volcanicminds.com)",
  "maintainers": [
    "Developers <developers@volcanicminds.com> (https://volcanicminds.com)"
  ]
}

```

## File: tsconfig.json

```javascript
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "noImplicitAny": false,
    "paths": {
      "@types": ["./types"]
    }
  },
  "include": ["*.ts", "*.d.ts", "lib/**/*", "types/*"],
  "exclude": ["node_modules", "dist", "test"]
}

```

## File: lib/feature1/index.ts

```typescript
export function feature1() {
  console.log('This is the feature1 export')
}

```

## File: lib/feature2/index.ts

```typescript
export function feature2() {
  console.log('This is an feature2 export')
}

```

## File: lib/main.ts

```typescript
export function main() {
  console.log('This is the main export')
}

```

## File: lib/util/logger.ts

```typescript
export function trace(data) {
  global.isLoggingEnabled && global.log?.trace && global.log.trace(data)
}

export function debug(data) {
  global.isLoggingEnabled && global.log?.debug && global.log.debug(data)
}

export function info(data) {
  global.isLoggingEnabled && global.log?.info && global.log.info(data)
}

export function warn(data) {
  global.isLoggingEnabled && global.log?.warn && global.log.warn(data)
}

export function error(data) {
  global.isLoggingEnabled && global.log?.error && global.log.error(data)
}

export function fatal(data) {
  global.isLoggingEnabled && global.log?.fatal && global.log.fatal(data)
}

```

## File: types/global.d.ts

```typescript
export interface MyInterface {
  default: any
  [option: string]: any
}

```
