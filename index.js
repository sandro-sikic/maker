import * as inquirer from '@inquirer/prompts';
import * as ora from 'ora';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function init() {
	// Ensure we're running in an interactive terminal
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error(
			'\n⚠ This TUI requires an interactive terminal. Run this in a terminal (not the Node REPL or a non-interactive/debug console).\n',
		);
		process.exit(1);
	}
}

/**
 * Run a shell command and stream output to the parent process while capturing the last N lines.
 *
 * Note: if you call `run(...)` without awaiting it (i.e. "run normally") it acts like a background
 * task; if you `await run(...)` (use inside an async function) the caller will wait for completion
 * and the call behaves like a foreground task.
 *
 * @param {string} command - Shell command to execute.
 * @param {Object} [opts]
 * @param {number} [opts.maxLines=10000] - Maximum number of lines to retain in captured output. (capture-only; not forwarded to the spawned process)
 * @param {Object} [opts] - Options forwarded directly to `child_process.spawn` (e.g. `cwd`, `env`, `stdio`).
 * @returns {Promise<{output:string, stdout:string, stderr:string, code:number|null, isError:boolean, error:Error|null}>}
 */
async function run(command, opts = {}) {
	if (typeof command !== 'string' || !command.trim()) {
		throw new TypeError('run() requires a non-empty string command');
	}

	// extract maxLines (used for capturing) and forward the rest of opts directly to spawn
	const { maxLines = 10000, ...forwardedOpts } = opts;

	// import spawn at runtime so test mocks (vi.mock) take effect per-test
	const { spawn } = await import('child_process');

	// Merge defaults with the caller-provided options. Caller options are forwarded
	// directly to spawn; `maxLines` is used only for output capture (not forwarded).
	const spawnOpts = Object.assign(
		{ shell: true, stdio: 'pipe' },
		forwardedOpts,
	);

	function trimToLastNLines(s, n) {
		if (!s) return s;
		// remove trailing newlines for accurate line counting
		const hadTrailingNewline = /(?:\r?\n)$/.test(s);
		const trimmed = s.replace(/(?:\r?\n)+$/g, '');
		const lines = trimmed.split(/\r?\n/);
		if (lines.length <= n) return hadTrailingNewline ? trimmed + '\n' : trimmed;
		const out = lines.slice(-n).join('\n');
		return hadTrailingNewline ? out + '\n' : out;
	}

	return new Promise((resolve) => {
		const child = spawn(command, spawnOpts);

		let stdout = '';
		let stderr = '';

		// stream to parent stdout/stderr while also capturing (keep only last maxLines)
		if (child.stdout) {
			child.stdout.on('data', (chunk) => {
				const s = chunk.toString();
				stdout += s;
				// trim if exceeded
				if ((stdout.match(/\r?\n/g) || []).length > maxLines) {
					stdout = trimToLastNLines(stdout, maxLines);
				}
				process.stdout.write(s);
			});
		}

		if (child.stderr) {
			child.stderr.on('data', (chunk) => {
				const s = chunk.toString();
				stderr += s;
				if ((stderr.match(/\r?\n/g) || []).length > maxLines) {
					stderr = trimToLastNLines(stderr, maxLines);
				}
				process.stderr.write(s);
			});
		}

		child.on('error', (err) => {
			// resolve with error info (non-throwing for convenience)
			resolve({
				output: stdout + stderr,
				stdout,
				stderr,
				code: null,
				isError: true,
				error: err,
			});
		});

		child.on('close', (code) => {
			const isError = code !== 0;
			resolve({
				output: stdout + stderr,
				stdout: trimToLastNLines(stdout, maxLines),
				stderr: trimToLastNLines(stderr, maxLines),
				code,
				isError,
				error: null,
			});
		});
	});
}

function onExit(cb) {
	if (typeof cb !== 'function') {
		throw new TypeError('onExit requires a callback function');
	}

	let called = false;

	const handler = async () => {
		if (called) return;
		called = true;

		const exiting = spinner('Gracefully shutting down...').start();

		try {
			await Promise.resolve(cb());
		} catch (err) {
			console.error('onExit callback error:', err);
		} finally {
			if (exiting && typeof exiting.stop === 'function') {
				exiting.stop();
			}
			process.exit(0);
		}
	};

	process.on('SIGINT', handler);
	process.on('SIGTERM', handler);
	process.on('SIGQUIT', handler);

	return () => {
		process.off('SIGINT', handler);
		process.off('SIGTERM', handler);
		process.off('SIGQUIT', handler);
	};
}

/**
 * Resolve path to the `config.cfg` file placed next to this module.
 * @returns {string}
 */
function _configPath() {
	const dir = path.dirname(fileURLToPath(import.meta.url));
	return path.join(dir, 'config.cfg');
}

/**
 * Save a value under `key` in `config.cfg` (creates file if missing).
 * - Overwrites existing keys
 * - Accepts objects and primitives (stored as JSON)
 *
 * @param {string} key
 * @param {*} value
 * @returns {void}
 */
function save(key, value) {
	if (typeof key !== 'string' || !key) {
		throw new TypeError('save(key, value) requires a non-empty string key');
	}

	const file = _configPath();
	let cfg = {};
	try {
		const txt = fs.readFileSync(file, 'utf8');
		cfg = txt.trim() ? JSON.parse(txt) : {};
	} catch (err) {
		if (err && err.code !== 'ENOENT') throw err;
		cfg = {};
	}

	cfg[key] = value;
	fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 * Load a value by `key` from `config.cfg` located next to this module.
 * Returns undefined when the file or key does not exist.
 *
 * @param {string} key
 * @returns {*|undefined}
 */
function load(key) {
	if (typeof key !== 'string' || !key) {
		throw new TypeError('load(key) requires a non-empty string key');
	}

	const file = _configPath();
	try {
		const txt = fs.readFileSync(file, 'utf8');
		if (!txt.trim()) return undefined;
		const cfg = JSON.parse(txt);
		return Object.prototype.hasOwnProperty.call(cfg, key)
			? cfg[key]
			: undefined;
	} catch (err) {
		if (err && err.code === 'ENOENT') return undefined;
		throw err;
	}
}

const prompt = inquirer.default ?? inquirer;
const spinner = ora.default ?? ora;

export { init, run, onExit, prompt, spinner, save, load };
