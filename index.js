import * as inquirer from '@inquirer/prompts';
import * as ora from 'ora';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// filename for runtime-generated storage types
const GENERATED_TYPES_FILENAME = 'storage.generated.d.ts';

let _overrideConfigPath = null;

function init(opts) {
	if (opts !== undefined) {
		if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
			throw new TypeError(
				'init(opts) expects an options object (e.g. { configPath?: string })',
			);
		}

		if (Object.prototype.hasOwnProperty.call(opts, 'configPath')) {
			if (typeof opts.configPath !== 'string') {
				throw new TypeError('init(opts).configPath must be a string');
			}
			_overrideConfigPath = opts.configPath;
		}
	}

	// Clear the auto-generated storage types file so previously-generated keys are removed
	try {
		const dir = path.dirname(fileURLToPath(import.meta.url));
		const gen = path.join(dir, GENERATED_TYPES_FILENAME);
		try {
			fs.unlinkSync(gen);
		} catch (err) {
			// ignore if file does not exist or cannot be removed
		}
	} catch (err) {
		/* non-fatal; don't prevent init from continuing */
		try {
			console.warn(
				'maker: failed to clear generated storage types:',
				err && err.message ? err.message : err,
			);
		} catch (__) {}
	}

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
 * If an override was provided to `init(opts)` return that path instead.
 * @returns {string}
 */
function _configPath() {
	if (_overrideConfigPath) return _overrideConfigPath;
	const dir = path.dirname(fileURLToPath(import.meta.url));
	return path.join(dir, 'config.json');
}

/**
 * Save a value under `key` in `config.cfg` (creates file if missing).
 * - Overwrites existing keys
 * - Accepts objects and primitives (stored as JSON)
 * - Additionally generates `storage.generated.d.ts` (next-time autocomplete)
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

	// Generate (or update) `storage.generated.d.ts` so consumers get autocomplete
	try {
		_writeGeneratedStorageTypes(file);
	} catch (err) {
		// non-fatal: don't break save() if typegen fails
		/* istanbul ignore next */
		try {
			console.warn(
				'maker: failed to generate storage types:',
				err && err.message ? err.message : err,
			);
		} catch (__) {}
	}
}

/**
 * Generate `storage.generated.d.ts` from the current config file.
 * This writes a declaration that augments `StorageSchema` with all keys
 * currently present in the config file so that TypeScript autocompletes
 * on subsequent runs.
 */
function _writeGeneratedStorageTypes(configFile) {
	const outDir = path.dirname(fileURLToPath(import.meta.url));
	const outPath = path.join(outDir, GENERATED_TYPES_FILENAME);
	let txt = '';
	try {
		txt = fs.readFileSync(configFile, 'utf8');
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			// nothing saved yet — remove generated file if it exists
			try {
				fs.unlinkSync(outPath);
			} catch (__) {}
			return;
		}
		throw err;
	}

	const cfg = txt.trim() ? JSON.parse(txt) : {};
	const keys = Object.keys(cfg).sort();

	function tsTypeForValue(v) {
		if (v === null) return 'null';
		const t = typeof v;
		if (t === 'string') return 'string';
		if (t === 'number') return 'number';
		if (t === 'boolean') return 'boolean';
		if (Array.isArray(v)) {
			if (v.length === 0) return 'unknown[]';
			const types = Array.from(new Set(v.map(tsTypeForValue)));
			if (types.length === 1) return `${types[0]}[]`;
			return `(${types.join(' | ')})[]`;
		}
		if (t === 'object') {
			// shallow object -> prefer a loose index signature to avoid fragile typings
			const props = Object.keys(v);
			if (props.length === 0) return 'Record<string, unknown>';
			// construct a shallow literal type for better DX when shape is simple
			const parts = props.map((p) => {
				const pn = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p) ? p : JSON.stringify(p);
				return `${pn}: ${tsTypeForValue(v[p])}`;
			});
			return `{ ${parts.join('; ')} }`;
		}
		return 'unknown';
	}

	const lines = keys.map((k) => {
		const v = cfg[k];
		const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
			? k
			: JSON.stringify(k);
		return `    ${safeKey}: ${tsTypeForValue(v)};`;
	});

	const content =
		`/* Auto-generated by maker — do not edit. */\n` +
		`interface StorageSchema {\n` +
		(lines.length ? lines.join('\n') + '\n' : '') +
		`}\n`;

	fs.writeFileSync(outPath, content, 'utf8');
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

const prompt = inquirer;
const spinner = ora.default;

export { init, run, onExit, prompt, spinner, save, load };
