import path from 'path';
import * as inquirer from '@inquirer/prompts';
import * as ora from 'ora';

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
async function run(command, opts = {}) {
	const { maxLines = 10000 } = opts;
	// import spawn at runtime so test mocks (vi.mock) take effect per-test
	const { spawn } = await import('child_process');
	// don't normalize the full command string — pass it through unchanged so shell
	// quoting and platform-specific behavior remain intact.
	const convertedCommand = command;

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

function onExit(cb) {
	if (typeof cb !== 'function') {
		throw new TypeError('onExit requires a callback function');
	}

	let called = false;
	let exiting = null;

	exiting = spinner('Gracefully shutting down...').start();

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

	return () => process.off('SIGINT', handler);
}

const prompt = inquirer.default ?? inquirer;
const spinner = ora.default ?? ora;

export { init, run, onExit, prompt, spinner };
