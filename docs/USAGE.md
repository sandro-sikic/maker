# Maker - Usage Guide

A lightweight library for building interactive command-line tools with ease. Maker provides utilities for running shell commands, handling user prompts, displaying spinners, and managing graceful shutdowns.

## Installation

```bash
npm install @sandro-sikic/maker
```

## Quick Start

```javascript
import * as maker from '@sandro-sikic/maker';

maker.init();

const answer = await maker.prompt.input({
	message: 'What is your name?',
});

const loading = maker.spinner('Processing...').start();
await maker.run('npm install');
loading.succeed('Installation complete!');
```

## API Reference

### `init()`

Initializes the CLI environment and validates that the application is running in an interactive terminal (TTY). This should be called at the start of your CLI application.

**Returns:** `void`

**Throws:** Exits with code 1 if not running in an interactive terminal

**Example:**

```javascript
import { init } from '@sandro-sikic/maker';

init(); // Call this first in your CLI app
```

**Why use it?**  
Prevents your CLI from running in incompatible environments like the Node REPL, non-interactive terminals, or debug consoles where user input cannot be properly handled.

---

### `run(command, opts)`

Executes a shell command with real-time output streaming to the parent process. Both stdout and stderr are displayed as the command runs, and the last N lines (default: 10,000) are captured for inspection.

**Parameters:**

- `command` (string, required) - The shell command to execute
- `opts` (object, optional)
  - `maxLines` (number) - Maximum number of output lines to retain in the captured output (default: 10000)

**Returns:** `Promise<RunResult>`

```typescript
type RunResult = {
	output: string; // Combined stdout + stderr
	stdout: string; // Standard output only
	stderr: string; // Standard error only
	code: number | null; // Exit code (null if spawn error)
	isError: boolean; // true if command failed or spawn error
	error: Error | null; // Error object if spawn failed
};
```

**Behavior:**

- **Foreground:** Use `await run(...)` to wait for command completion before continuing
- **Background:** Call `run(...)` without await to let it execute concurrently

**Examples:**

**Basic usage (foreground):**

```javascript
import { run } from '@sandro-sikic/maker';

// Wait for command to complete
const result = await run('npm test');

if (result.isError) {
	console.error('Tests failed!', result.stderr);
	process.exit(1);
}
```

**Background execution:**

```javascript
// Start command and continue immediately
run('npm run dev'); // Runs in background

// Your code continues here while the command executes
await someOtherTask();
```

**With custom output limit:**

```javascript
// Only keep last 100 lines of output
const result = await run('npm run build', { maxLines: 100 });
console.log('Build output:', result.stdout);
```

**Multiple sequential commands:**

```javascript
await run('npm install');
await run('npm run build');
await run('npm test');
```

---

### `onExit(callback)`

Registers a cleanup function that executes gracefully when the process receives termination signals (SIGINT, SIGTERM, SIGQUIT). Perfect for cleanup tasks like closing database connections, saving state, or stopping servers.

**Parameters:**

- `callback` (function, required) - Sync or async function to execute on exit. Can return a Promise.

**Returns:** `Function` - An unregister function to remove the handler

**Example:**

**Basic cleanup:**

```javascript
import { onExit } from '@sandro-sikic/maker';

onExit(() => {
	console.log('Cleaning up...');
	// Close connections, save state, etc.
});
```

**Async cleanup:**

```javascript
onExit(async () => {
	await database.close();
	await server.stop();
	console.log('Shutdown complete');
});
```

**Unregister handler:**

```javascript
const cleanup = onExit(() => {
	console.log('Exiting...');
});

// Later, if needed:
cleanup(); // Removes the exit handler
```

**Features:**

- Automatically displays a "Gracefully shutting down..." spinner during cleanup
- Prevents multiple executions if signal is received multiple times
- Catches and logs errors in your callback
- Ensures `process.exit(0)` is called after cleanup completes

---

### `prompt`

Direct re-export of [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js/tree/master/packages/prompts) with all its interactive prompt types.

**Available prompt types:**

- `input` - Free text input
- `number` - Numeric input
- `confirm` - Yes/no confirmation
- `select` - Choose one option from a list
- `checkbox` - Choose multiple options
- `password` - Hidden input for sensitive data
- `editor` - Launch external editor for multi-line input
- `search` - Select with search filtering
- `rawlist` - List selection by number

**Examples:**

**Text input:**

```javascript
import { prompt } from '@sandro-sikic/maker';

const name = await prompt.input({
	message: 'What is your name?',
	default: 'John Doe',
});
```

**Confirmation:**

```javascript
const confirmed = await prompt.confirm({
	message: 'Continue with installation?',
	default: true,
});

if (!confirmed) {
	process.exit(0);
}
```

**Select from list:**

```javascript
const framework = await prompt.select({
	message: 'Choose a framework:',
	choices: [
		{ name: 'React', value: 'react' },
		{ name: 'Vue', value: 'vue' },
		{ name: 'Angular', value: 'angular' },
	],
});

console.log(`Selected: ${framework}`);
```

**Multiple selection:**

```javascript
const features = await prompt.checkbox({
	message: 'Select features to install:',
	choices: [
		{ name: 'TypeScript', value: 'typescript', checked: true },
		{ name: 'ESLint', value: 'eslint' },
		{ name: 'Prettier', value: 'prettier' },
	],
});

console.log('Installing:', features.join(', '));
```

**Password input:**

```javascript
const apiKey = await prompt.password({
	message: 'Enter your API key:',
	mask: '*',
});
```

For more details on prompt options and types, see the [Inquirer.js documentation](https://github.com/SBoudrias/Inquirer.js/tree/master/packages/prompts).

---

### `spinner`

Direct re-export of [ora](https://github.com/sindresorhus/ora) for elegant terminal spinners and status indicators.

**Basic usage:**

```javascript
import { spinner } from '@sandro-sikic/maker';

const loading = spinner('Loading...').start();

// Do some work...
await someAsyncTask();

loading.succeed('Done!');
```

**Common methods:**

- `start()` - Begin spinning
- `succeed(text?)` - Complete with success (✔)
- `fail(text?)` - Complete with error (✖)
- `warn(text?)` - Complete with warning (⚠)
- `info(text?)` - Complete with info (ℹ)
- `stop()` - Stop and clear
- `clear()` - Clear from terminal

**Examples:**

**Success/failure flow:**

```javascript
const build = spinner('Building project...').start();

try {
	await run('npm run build');
	build.succeed('Build completed successfully');
} catch (error) {
	build.fail('Build failed');
	throw error;
}
```

**Update spinner text:**

```javascript
const progress = spinner('Step 1/3').start();

await step1();
progress.text = 'Step 2/3';

await step2();
progress.text = 'Step 3/3';

await step3();
progress.succeed('All steps completed!');
```

**Multiple sequential operations:**

```javascript
const install = spinner('Installing dependencies...').start();
await run('npm install');
install.succeed('Dependencies installed');

const build = spinner('Building application...').start();
await run('npm run build');
build.succeed('Build complete');

const test = spinner('Running tests...').start();
await run('npm test');
test.succeed('All tests passed');
```

For advanced spinner options and customization, see the [ora documentation](https://github.com/sindresorhus/ora).

---

## Complete Examples

### Example 1: Simple CLI Tool

```javascript
import * as maker from '@sandro-sikic/maker';

async function main() {
	maker.init();

	const projectName = await maker.prompt.input({
		message: 'Project name:',
		default: 'my-project',
	});

	const installing = maker.spinner('Creating project...').start();
	await maker.run(`mkdir ${projectName}`);
	await maker.run(`cd ${projectName} && npm init -y`);
	installing.succeed(`Project ${projectName} created!`);
}

main();
```

### Example 2: Build Tool with Cleanup

```javascript
import * as maker from '@sandro-sikic/maker';

async function buildTool() {
	maker.init();

	// Register cleanup handler
	maker.onExit(async () => {
		console.log('Cleaning up build artifacts...');
		await maker.run('rm -rf .temp');
	});

	const shouldBuild = await maker.prompt.confirm({
		message: 'Start build process?',
		default: true,
	});

	if (!shouldBuild) {
		console.log('Build cancelled');
		process.exit(0);
	}

	const building = maker.spinner('Building...').start();
	const result = await maker.run('npm run build');

	if (result.isError) {
		building.fail('Build failed!');
		console.error(result.stderr);
		process.exit(1);
	}

	building.succeed('Build successful!');
}

buildTool();
```

### Example 3: Interactive Setup Wizard

```javascript
import * as maker from '@sandro-sikic/maker';

async function setup() {
	maker.init();

	console.log('Welcome to the Setup Wizard!\n');

	const config = {
		name: await maker.prompt.input({
			message: 'Project name:',
		}),

		framework: await maker.prompt.select({
			message: 'Choose a framework:',
			choices: [
				{ name: 'React', value: 'react' },
				{ name: 'Vue', value: 'vue' },
				{ name: 'Vanilla', value: 'vanilla' },
			],
		}),

		features: await maker.prompt.checkbox({
			message: 'Additional features:',
			choices: [
				{ name: 'TypeScript', value: 'typescript' },
				{ name: 'ESLint', value: 'eslint' },
				{ name: 'Testing', value: 'testing' },
			],
		}),
	};

	console.log('\nConfiguration:', config);

	const confirm = await maker.prompt.confirm({
		message: 'Proceed with installation?',
		default: true,
	});

	if (!confirm) {
		console.log('Setup cancelled');
		return;
	}

	const installing = maker.spinner('Setting up project...').start();

	// Create project directory
	await maker.run(`mkdir ${config.name}`);

	// Install framework
	installing.text = `Installing ${config.framework}...`;
	await maker.run(`cd ${config.name} && npm init -y`);
	await maker.run(`cd ${config.name} && npm install ${config.framework}`);

	// Install features
	for (const feature of config.features) {
		installing.text = `Installing ${feature}...`;
		await maker.run(`cd ${config.name} && npm install ${feature}`);
	}

	installing.succeed('Project setup complete! 🎉');
	console.log(`\nNext steps:\n  cd ${config.name}\n  npm start`);
}

setup();
```

### Example 4: Development Server Manager

```javascript
import * as maker from '@sandro-sikic/maker';

async function devServer() {
	maker.init();

	// Graceful shutdown handler
	maker.onExit(async () => {
		console.log('\nStopping development server...');
		// Additional cleanup if needed
	});

	const port = await maker.prompt.number({
		message: 'Port number:',
		default: 3000,
	});

	const watch = await maker.prompt.confirm({
		message: 'Enable watch mode?',
		default: true,
	});

	const starting = maker.spinner('Starting server...').start();

	// Start server in background
	const watchFlag = watch ? '--watch' : '';
	maker.run(`npm run dev ${watchFlag} -- --port ${port}`);

	await new Promise((resolve) => setTimeout(resolve, 2000));
	starting.succeed(`Server running on http://localhost:${port}`);

	console.log('\nPress Ctrl+C to stop the server');

	// Keep process alive
	await new Promise(() => {});
}

devServer();
```

## TypeScript Support

This library includes TypeScript definitions. Import types as needed:

```typescript
import { run, RunResult, Ora } from '@sandro-sikic/maker';

const result: RunResult = await run('echo "Hello"');
const spinner: Ora = maker.spinner('Loading...');
```

## Best Practices

1. **Always call `init()` first** - Ensures your CLI runs in a proper terminal environment

2. **Use spinners for long operations** - Provides visual feedback that something is happening

3. **Handle errors gracefully** - Check `result.isError` from `run()` calls and provide helpful error messages

4. **Register cleanup handlers** - Use `onExit()` for proper resource cleanup

5. **Provide good defaults** - Use the `default` option in prompts to speed up common workflows

6. **Combine with async/await** - The API is designed for clean async/await patterns

7. **Stream long-running commands** - Let `run()` stream output in real-time for better UX

## Troubleshooting

### "This TUI requires an interactive terminal"

This error means your code isn't running in a proper terminal. Make sure you're:

- Running in a real terminal (not Node REPL)
- Not running in a non-interactive environment (like CI without proper TTY setup)
- Not running in a debug console that doesn't support TTY

### Spinner not visible

If spinners don't appear:

- Ensure you called `init()` first
- Check that you're in an interactive terminal
- Verify CI environments have TTY support if running in CI

### Command output truncated

By default, `run()` keeps the last 10,000 lines. For commands with massive output:

```javascript
// Increase the line limit
await run('very-verbose-command', { maxLines: 50000 });
```

## License

ISC

## Repository

https://github.com/sandro-sikic/maker
