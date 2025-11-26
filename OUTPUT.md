# Volcanic Tools - Updated At 2025-11-26T09:40:50.778Z

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
v18.12.0

```

## File: README.md

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-typeorm](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-typeorm)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/typeorm)

# volcanic-tools

## How to install

```js
yarn add @volcanicminds/tools
```

It's possible use this module with module [`@volcanicminds/backend`](https://github.com/volcanicminds/volcanic-backend)

## How to upgrade packages

```js
yarn upgrade-deps
```

## Enviroment

```rb
# or automatically use LOG_LEVEL
SOME_KEY=true
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
'use strict'

import feature1 from './lib/feature1/index.js'
import feature2 from './lib/feature2/index.js'

module.exports = { feature1, feature2 }
module.exports.feature1 = feature1
module.exports.feature2 = feature2
module.exports.default = { feature1, feature2 }

export { feature1, feature2 }

```

## File: package.json

```javascript
{
  "name": "@volcanicminds/tools",
  "version": "0.0.1",
  "license": "MIT",
  "description": "Tools for the volcanic (minds) backend",
  "keywords": [
    "volcanic",
    "open source",
    "tools",
    "typescript",
    "javascript"
  ],
  "main": "index.js",
  "module": "index.js",
  "types": "dist/index.d.ts",
  "directories": {
    "lib": "lib"
  },
  "files": [
    "dist/*"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./*.js": {
      "types": "./dist/*.d.ts",
      "import": "./dist/*.js"
    }
  },
  "engines": {
    "node": ">=16"
  },
  "scripts": {
    "clean": "rm -rf dist esm",
    "prebuild": "npm run clean",
    "build:esm": "tsc --target es2018 --outDir esm",
    "build:cjs": "tsc --target es2015 --module commonjs --outDir dist",
    "build": "npm run build:esm && npm run build:cjs",
    "compile": "npm run build",
    "reset": "yarn && yarn upgrade && yarn compile",
    "upgrade-deps": "yarn upgrade-interactive",
    "combine": "node combine.js"
  },
  "devDependencies": {
    "@types/node": "^18.11.10",
    "ts-node": "^10.9.1",
    "typescript": "^4.9.3"
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
// https://typestrong.org/ts-node/docs/configuration/
{
  "compilerOptions": {
    "module": "ES2020",
    "moduleResolution": "Node16",
    "outDir": "dist"
  },
  "src": ["lib"]
}

```

## File: lib/feature1/index.ts

```typescript
export default function alternativeMain() {
  console.log('This is an feature2 export')
}

```

## File: lib/feature2/index.ts

```typescript
export default function main() {
  console.log('This is the feature1 export')
}

```

## File: lib/main.ts

```typescript
export default function main() {
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
