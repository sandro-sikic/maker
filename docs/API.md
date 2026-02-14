# Maker - API Quick Reference

Quick reference guide for `@sandro-sikic/maker` functions.

---

## `init()`

Validates interactive terminal environment. **Call first** in your CLI app.

```javascript
maker.init();
```

Exits with code 1 if not running in an interactive terminal (TTY).

---

## `run(command, opts)`

Execute shell commands with streaming output.

```javascript
const result = await run('npm install', { maxLines: 10000 });
```

**Parameters:**

- `command` - Shell command string (required)
- `opts.maxLines` - Max output lines to capture (default: 10000)

**Returns:**

```javascript
{
  output: string,      // Combined stdout + stderr
  stdout: string,      // Standard output
  stderr: string,      // Standard error
  code: number|null,   // Exit code
  isError: boolean,    // true if failed
  error: Error|null    // Spawn error if any
}
```

**Usage patterns:**

```javascript
// Foreground (waits for completion)
await run('npm test');

// Background (non-blocking)
run('npm run dev');

// Error handling
const result = await run('npm build');
if (result.isError) {
	console.error('Failed:', result.stderr);
}
```

---

## `onExit(callback)`

Register cleanup function for graceful shutdown.

```javascript
onExit(async () => {
	await cleanup();
});
```

**Parameters:**

- `callback` - Sync or async cleanup function

**Returns:**

- Unregister function

**Triggers on:**

- SIGINT (Ctrl+C)
- SIGTERM
- SIGQUIT

---

## `prompt.*`

Interactive prompts ([inquirer](https://github.com/SBoudrias/Inquirer.js/tree/master/packages/prompts)).

```javascript
// Text input
await prompt.input({ message: 'Name?' });

// Yes/no
await prompt.confirm({ message: 'Continue?' });

// Select one
await prompt.select({
  message: 'Choose:',
  choices: [
    { name: 'Option 1', value: '1' },
    { name: 'Option 2', value: '2' }
  ]
});

// Select multiple
await prompt.checkbox({
  message: 'Select:',
  choices: [...]
});

// Password
await prompt.password({ message: 'API key:' });

// Number
await prompt.number({ message: 'Port:', default: 3000 });
```

---

## `spinner(text)`

Terminal spinner ([ora](https://github.com/sindresorhus/ora)).

```javascript
const s = spinner('Loading...').start();

// Update text
s.text = 'Still loading...';

// Complete
s.succeed('Done!'); // ✔
s.fail('Failed!'); // ✖
s.warn('Warning!'); // ⚠
s.info('Info!'); // ℹ
s.stop(); // Stop and clear
```

---

## Complete Example

```javascript
import * as maker from '@sandro-sikic/maker';

// 1. Initialize
maker.init();

// 2. Register cleanup
maker.onExit(async () => {
	console.log('Cleaning up...');
});

// 3. Prompt user
const name = await maker.prompt.input({
	message: 'Project name:',
	default: 'my-app',
});

const confirmed = await maker.prompt.confirm({
	message: 'Install dependencies?',
});

// 4. Run commands with spinner
if (confirmed) {
	const s = maker.spinner('Installing...').start();

	const result = await maker.run(`npm create ${name}`);

	if (result.isError) {
		s.fail('Installation failed');
		process.exit(1);
	}

	s.succeed('Installation complete!');
}
```

---

## TypeScript Types

```typescript
import type { RunResult, Ora } from '@sandro-sikic/maker';

// Also exports all @inquirer/prompts types
import type { ConfirmPrompt, InputPrompt } from '@sandro-sikic/maker';
```
