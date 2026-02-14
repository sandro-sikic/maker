# Maker

A lightweight library for building interactive command-line tools with ease.

[![npm version](https://img.shields.io/npm/v/@sandro-sikic/maker)](https://www.npmjs.com/package/@sandro-sikic/maker)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## Features

✨ **Simple API** - Just 5 core functions to build powerful CLI tools  
🎯 **Interactive Prompts** - Built-in support for user input via [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js)  
⚡ **Command Execution** - Run shell commands with streaming output  
🎨 **Beautiful Spinners** - Visual feedback with [ora](https://github.com/sindresorhus/ora)  
🛡️ **Graceful Shutdown** - Automatic cleanup on exit signals  
📘 **TypeScript Support** - Full type definitions included

## Installation

```bash
npm install @sandro-sikic/maker
```

## Quick Start

```javascript
import * as maker from '@sandro-sikic/maker';

// Initialize CLI environment
maker.init();

// Prompt user for input
const name = await maker.prompt.input({
	message: 'What is your project name?',
});

// Show progress with spinner
const loading = maker.spinner('Creating project...').start();

// Run shell commands
await maker.run(`mkdir ${name}`);
await maker.run(`cd ${name} && npm init -y`);

loading.succeed('Project created! 🎉');
```

## API Overview

### Core Functions

| Function             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `init()`             | Validates interactive terminal environment         |
| `run(command, opts)` | Executes shell commands with streaming output      |
| `onExit(callback)`   | Registers cleanup function for graceful shutdown   |
| `prompt.*`           | Interactive prompts (input, select, confirm, etc.) |
| `spinner(text)`      | Creates terminal loading indicators                |

### Example: Simple Build Tool

```javascript
import * as maker from '@sandro-sikic/maker';

async function build() {
	maker.init();

	// Register cleanup
	maker.onExit(() => {
		console.log('Cleanup complete');
	});

	// Confirm action
	const shouldBuild = await maker.prompt.confirm({
		message: 'Start build?',
		default: true,
	});

	if (!shouldBuild) return;

	// Execute with spinner
	const building = maker.spinner('Building...').start();
	const result = await maker.run('npm run build');

	if (result.isError) {
		building.fail('Build failed!');
		process.exit(1);
	}

	building.succeed('Build complete!');
}

build();
```

## Documentation

📖 **[Complete Usage Guide](./docs/USAGE.md)** - Detailed documentation with examples  
⚡ **[API Quick Reference](./docs/API.md)** - Fast lookup for all functions

## API Details

### `init()`

Ensures your CLI is running in an interactive terminal. Always call this first.

```javascript
maker.init();
```

### `run(command, opts)`

Execute shell commands with real-time output streaming.

```javascript
const result = await maker.run('npm test');

if (result.isError) {
	console.error('Command failed:', result.stderr);
}
```

**Returns:** `{ output, stdout, stderr, code, isError, error }`

### `onExit(callback)`

Register cleanup handlers for graceful shutdown (SIGINT, SIGTERM, SIGQUIT).

```javascript
maker.onExit(async () => {
	await closeDatabase();
	await stopServer();
});
```

### `prompt.*`

Interactive prompts powered by [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js):

```javascript
await maker.prompt.input({ message: 'Name?' });
await maker.prompt.confirm({ message: 'Continue?' });
await maker.prompt.select({ message: 'Choose:', choices: [...] });
await maker.prompt.checkbox({ message: 'Select:', choices: [...] });
await maker.prompt.password({ message: 'API key:' });
```

### `spinner(text)`

Create terminal spinners with [ora](https://github.com/sindresorhus/ora):

```javascript
const s = maker.spinner('Loading...').start();
s.succeed('Done!'); // ✔
s.fail('Failed!'); // ✖
s.warn('Warning!'); // ⚠
s.info('Info!'); // ℹ
```

## Real-World Example

```javascript
import * as maker from '@sandro-sikic/maker';

async function setupProject() {
	maker.init();

	// Get project configuration
	const config = {
		name: await maker.prompt.input({
			message: 'Project name:',
		}),
		framework: await maker.prompt.select({
			message: 'Framework:',
			choices: [
				{ name: 'React', value: 'react' },
				{ name: 'Vue', value: 'vue' },
				{ name: 'Angular', value: 'angular' },
			],
		}),
		features: await maker.prompt.checkbox({
			message: 'Features:',
			choices: [
				{ name: 'TypeScript', value: 'typescript' },
				{ name: 'ESLint', value: 'eslint' },
				{ name: 'Testing', value: 'testing' },
			],
		}),
	};

	// Confirm setup
	const proceed = await maker.prompt.confirm({
		message: 'Create project?',
		default: true,
	});

	if (!proceed) {
		console.log('Cancelled');
		return;
	}

	// Setup with progress indicators
	const setup = maker.spinner('Creating project...').start();

	await maker.run(`mkdir ${config.name}`);
	setup.text = 'Installing dependencies...';
	await maker.run(`cd ${config.name} && npm init -y`);
	await maker.run(`cd ${config.name} && npm install ${config.framework}`);

	for (const feature of config.features) {
		setup.text = `Installing ${feature}...`;
		await maker.run(`cd ${config.name} && npm install ${feature}`);
	}

	setup.succeed('Project ready! 🚀');
	console.log(`\nNext:\n  cd ${config.name}\n  npm start`);
}

setupProject();
```

## TypeScript

Full TypeScript support with included type definitions:

```typescript
import { run, RunResult, Ora } from '@sandro-sikic/maker';

const result: RunResult = await run('echo "Hello"');
const spinner: Ora = maker.spinner('Loading...');
```

## Repository

[github.com/sandro-sikic/maker](https://github.com/sandro-sikic/maker)

## License

ISC

## Credits

Built with:

- [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) - Interactive prompts
- [ora](https://github.com/sindresorhus/ora) - Terminal spinners
