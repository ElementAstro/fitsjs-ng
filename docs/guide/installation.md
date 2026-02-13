# Installation

## As a Dependency

Install the library in your project:

::: code-group

```bash [pnpm]
pnpm add typescript-quick-starter
```

```bash [npm]
npm install typescript-quick-starter
```

```bash [yarn]
yarn add typescript-quick-starter
```

:::

## Usage

### ESM

```ts
import { greet } from 'typescript-quick-starter'

console.log(greet('World')) // Hello, World!
```

### CommonJS

```js
const { greet } = require('typescript-quick-starter')

console.log(greet('World')) // Hello, World!
```
