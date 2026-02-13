# API Reference

## `greet`

Returns a greeting string for the given name.

### Signature

```ts
function greet(name: string): string
```

### Parameters

| Parameter | Type     | Description       |
| --------- | -------- | ----------------- |
| `name`    | `string` | The name to greet |

### Returns

`string` — A greeting message in the format `Hello, {name}!`

### Example

```ts
import { greet } from 'typescript-quick-starter'

greet('World') // => 'Hello, World!'
greet('Alice') // => 'Hello, Alice!'
```
