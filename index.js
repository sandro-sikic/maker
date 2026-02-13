const { spawn } = require('child_process');
const path = require('path');

// small helper to lazily load (CJS-first, ESM dynamic import fallback)
function makeLazyLoader(moduleId) {
	let _cached = null;
	return async function load() {
		if (_cached) return _cached;
		try {
			/* eslint-disable global-require, import/no-dynamic-require */
			const mod = require(moduleId);
			_cached = mod && (mod.default || mod);
			return _cached;
		} catch (err) {
			try {
				const ns = await import(moduleId);
				_cached = ns && (ns.default || ns);
				return _cached;
			} catch (e) {
				// unable to load in this environment — return null so callers can continue
				return null;
			}
		}
	};
}

const loadPrompts = makeLazyLoader('@inquirer/prompts');
const loadOra = makeLazyLoader('ora');

function init() {
	// Ensure we're running in an interactive terminal
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error(
			'\n️This TUI requires an interactive terminal. Run this in a terminal (not the Node REPL or a non-interactive/debug console).\n',
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
 * @param {string} command - Shell command to execute (will be run with `shell: true`).
 * @param {Object} [opts]
 * @param {number} [opts.maxLines=10000] - Maximum number of lines to retain in captured output.
 * @returns {Promise<{output:string, stdout:string, stderr:string, code:number|null, isError:boolean, error:Error|null}>}
 */
function run(command, opts = {}) {
	const { maxLines = 10000 } = opts;
	const normalized = path.normalize(command);
	const split = normalized.split('/');
	const convertedCommand = path.join(...split);

	function trimToLastNLines(s, n) {
		if (!s) return s;
		const lines = s.split(/\r?\n/);
		if (lines.length <= n) return s;
		return lines.slice(-n).join('\n');
	}

	return new Promise((resolve) => {
		const child = spawn(convertedCommand, { shell: true, stdio: 'pipe' });

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

/**
 * Register a callback to run when the process receives SIGINT (Ctrl+C).
 * - Accepts a function (may be async).
 * - Returns a disposer function that removes the listener.
 *
 * Note: spinner is started asynchronously (ora is lazy-loaded); onExit itself
 * remains synchronous so callers can register the handler immediately.
 */
function onExit(cb) {
	if (typeof cb !== 'function') {
		throw new TypeError('onExit requires a callback function');
	}

	let called = false;
	let exiting = null;

	// start spinner asynchronously (best-effort; ignore load errors)
	loadOra().then((o) => {
		try {
			exiting = o('Gracefully shutting down...').start();
		} catch (e) {
			/* ignore */
		}
	});

	const handler = async () => {
		if (called) return;
		called = true;
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

	// return a function that removes the listener in case the caller wants to cancel
	return () => process.off('SIGINT', handler);
}

// `prompt` is an async wrapper around the ESM-only `@inquirer/prompts` package.
// `prompt(...args)` forwards the call to the underlying module and returns its result.
async function prompt(...args) {
	const p = await loadPrompts();
	if (!p) return null; // prompts unavailable in this environment
	return p(...args);
}

async function spinner(...args) {
	const s = await loadOra();
	return s(...args);
}

module.exports = {
	init,
	run,
	onExit,
	prompt,
	spinner,
};
