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
