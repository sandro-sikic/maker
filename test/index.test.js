import { describe, it, expect, vi } from 'vitest';

vi.mock('ora', () => ({
	default: () => ({ start: () => ({ stop: () => {} }) }),
}));

import { run, onExit, init, prompt, spinner } from '../index.js';

describe('run()', () => {
	it('captures stdout for successful commands (mocked)', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) stdoutCb(Buffer.from('hello\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		console.log('DEBUG run stdout test ->', res);
		expect(res.isError).toBe(false);
		expect(res.code).toBe(0);
		expect(res.stdout).toMatch(/hello/i);
		vi.resetModules();
	});

	it('captures stderr and non-zero exit code (mocked)', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stderrCb;
				let closeCb;
				const child = {
					stdout: { on: () => {} },
					stderr: {
						on: (ev, cb) => {
							if (ev === 'data') stderrCb = cb;
						},
					},
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stderrCb) stderrCb(Buffer.from('err\n'));
					if (closeCb) closeCb(3);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.isError).toBe(true);
		expect(res.code).toBe(3);
		expect(res.stderr).toMatch(/err/);
		vi.resetModules();
	});

	it('trims stdout and stderr to the provided maxLines (mocked)', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let stderrCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: {
						on: (ev, cb) => {
							if (ev === 'data') stderrCb = cb;
						},
					},
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb)
						stdoutCb(
							Buffer.from(
								Array.from({ length: 20 })
									.map((_, i) => i)
									.join('\n') + '\n',
							),
						);
					if (stderrCb)
						stderrCb(
							Buffer.from(
								Array.from({ length: 20 })
									.map((_, i) => i + 'e')
									.join('\n') + '\n',
							),
						);
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', { maxLines: 5 });
		// only the last lines should be present
		expect(res.stdout).toMatch(/15/);
		expect(res.stdout).not.toMatch(/0/);
		expect(
			res.stdout.split(/\r?\n/).filter(Boolean).length,
		).toBeLessThanOrEqual(5);
		expect(res.stderr).toMatch(/15e/);
		expect(res.stderr).not.toMatch(/0e/);
		expect(
			res.stderr.split(/\r?\n/).filter(Boolean).length,
		).toBeLessThanOrEqual(5);
		vi.resetModules();
	});

	it('streams child output to parent stdout/stderr (mocked)', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let stderrCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: {
						on: (ev, cb) => {
							if (ev === 'data') stderrCb = cb;
						},
					},
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) stdoutCb(Buffer.from('hello\n'));
					if (stderrCb) stderrCb(Buffer.from('bye\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const spyOut = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		const spyErr = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);

		await mockedRun('anything');

		expect(spyOut).toHaveBeenCalledWith(expect.stringMatching(/hello/));
		expect(spyErr).toHaveBeenCalledWith(expect.stringMatching(/bye/));

		spyOut.mockRestore();
		spyErr.mockRestore();
		vi.resetModules();
	});

	it('resolves with error info when spawn emits error', async () => {
		// load a fresh module with child_process mocked so `run()` sees the mocked spawn
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => ({
				stdout: null,
				stderr: null,
				on: (ev, cb) => {
					if (ev === 'error')
						setTimeout(() => cb(new Error('mock spawn error')), 0);
				},
			}),
		}));

		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('does-not-matter');

		expect(res.isError).toBe(true);
		expect(res.code).toBeNull();
		expect(res.error).toBeInstanceOf(Error);
		expect(res.error.message).toMatch(/mock spawn error/);

		// restore module cache for subsequent tests
		vi.resetModules();
	});
});

describe('onExit()', () => {
	it('throws if callback is not a function', () => {
		expect(() => onExit(123)).toThrow(TypeError);
	});

	it('returns an unsubscribe function', () => {
		const off = onExit(() => {});
		expect(typeof off).toBe('function');
		off();
	});

	it('invokes callback on SIGINT and exits after async callback', async () => {
		const cb = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 20));
		expect(cb).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		exitSpy.mockRestore();
	});

	it('does not call callback after unsubscribe', () => {
		const cb = vi.fn();
		const off = onExit(cb);
		off();
		process.emit('SIGINT');
		expect(cb).not.toHaveBeenCalled();
	});

	it('only runs callback once even if SIGINT emitted multiple times', async () => {
		const cb = vi.fn(async () => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGINT');
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		exitSpy.mockRestore();
	});

	it('catches errors from callback and still exits', async () => {
		const err = new Error('boom');
		const cb = vi.fn(async () => {
			throw err;
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));
		expect(cb).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith('onExit callback error:', err);
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		consoleSpy.mockRestore();
		exitSpy.mockRestore();
	});
});

describe('init()', () => {
	it('does nothing when stdin/stdout are TTY', () => {
		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;
		expect(() => init()).not.toThrow();
		expect(exitSpy).not.toHaveBeenCalled();
		exitSpy.mockRestore();
		process.stdin.isTTY = origStdinTTY;
		process.stdout.isTTY = origStdoutTTY;
	});

	it('exits with code 1 and logs error when not in a TTY', () => {
		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		process.stdin.isTTY = false;
		process.stdout.isTTY = false;
		init();
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('This TUI requires an interactive terminal'),
		);
		consoleSpy.mockRestore();
		exitSpy.mockRestore();
		process.stdin.isTTY = origStdinTTY;
		process.stdout.isTTY = origStdoutTTY;
	});
});

describe('exports', () => {
	it('exposes `prompt` and `spinner`', () => {
		expect(prompt).toBeDefined();
		expect(typeof spinner).toBe('function');
		const s = spinner('x');
		expect(typeof s.start).toBe('function');
		expect(typeof s.start().stop).toBe('function');
	});
});

describe('run() - additional edge cases', () => {
	it('combines stdout and stderr in output field', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let stderrCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: {
						on: (ev, cb) => {
							if (ev === 'data') stderrCb = cb;
						},
					},
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) stdoutCb(Buffer.from('out\n'));
					if (stderrCb) stderrCb(Buffer.from('err\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.output).toContain('out');
		expect(res.output).toContain('err');
		expect(res.output).toBe(res.stdout + res.stderr);
		vi.resetModules();
	});

	it('handles null stdout stream gracefully', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let closeCb;
				const child = {
					stdout: null,
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.code).toBe(0);
		expect(res.stdout).toBe('');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('handles null stderr stream gracefully', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let closeCb;
				const child = {
					stdout: { on: () => {} },
					stderr: null,
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.code).toBe(0);
		expect(res.stderr).toBe('');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('handles multiple data chunks correctly', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) {
						stdoutCb(Buffer.from('chunk1\n'));
						stdoutCb(Buffer.from('chunk2\n'));
						stdoutCb(Buffer.from('chunk3\n'));
					}
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout).toContain('chunk1');
		expect(res.stdout).toContain('chunk2');
		expect(res.stdout).toContain('chunk3');
		vi.resetModules();
	});

	it('handles output with no trailing newline', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) stdoutCb(Buffer.from('no newline'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout).toBe('no newline');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('preserves Windows-style line endings (CRLF)', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (stdoutCb) stdoutCb(Buffer.from('line1\r\nline2\r\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout).toContain('\r\n');
		expect(res.stdout).toMatch(/line1\r\nline2/);
		vi.resetModules();
	});

	it('uses default maxLines of 10000 when not specified', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let stdoutCb;
				let closeCb;
				const child = {
					stdout: {
						on: (ev, cb) => {
							if (ev === 'data') stdoutCb = cb;
						},
					},
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					// Send 50 lines - should all be kept with default maxLines
					if (stdoutCb) {
						const lines =
							Array.from({ length: 50 })
								.map((_, i) => `line${i}`)
								.join('\n') + '\n';
						stdoutCb(Buffer.from(lines));
					}
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything'); // No maxLines option
		expect(res.stdout).toContain('line0');
		expect(res.stdout).toContain('line49');
		const lineCount = res.stdout.split(/\r?\n/).filter(Boolean).length;
		expect(lineCount).toBe(50);
		vi.resetModules();
	});

	it('returns error null when command completes successfully', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let closeCb;
				const child = {
					stdout: { on: () => {} },
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') closeCb = cb;
					},
				};
				process.nextTick(() => {
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.error).toBeNull();
		expect(res.isError).toBe(false);
		vi.resetModules();
	});
});

describe('onExit() - additional edge cases', () => {
	it('handles synchronous callback', async () => {
		const cb = vi.fn(() => {
			// Synchronous callback
			return 'done';
		});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));
		expect(cb).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		exitSpy.mockRestore();
	});

	it('stops spinner before exiting', async () => {
		const stopFn = vi.fn();
		const startFn = vi.fn(() => ({ stop: stopFn }));
		const mockSpinner = vi.fn(() => ({ start: startFn }));

		vi.resetModules();
		vi.doMock('ora', () => ({
			default: mockSpinner,
		}));

		const { onExit: mockedOnExit } = await import('../index.js');
		const cb = vi.fn(async () => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

		const off = mockedOnExit(cb);
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));

		expect(mockSpinner).toHaveBeenCalledWith('Gracefully shutting down...');
		expect(startFn).toHaveBeenCalled();
		expect(stopFn).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);

		off();
		exitSpy.mockRestore();
		vi.resetModules();
	});

	it('supports multiple independent handlers', async () => {
		const cb1 = vi.fn(async () => {});
		const cb2 = vi.fn(async () => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

		const off1 = onExit(cb1);
		const off2 = onExit(cb2);

		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));

		expect(cb1).toHaveBeenCalled();
		expect(cb2).toHaveBeenCalled();

		off1();
		off2();
		exitSpy.mockRestore();
	});
});

describe('init() - additional edge cases', () => {
	it('exits when only stdin is not TTY', () => {
		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		process.stdin.isTTY = false;
		process.stdout.isTTY = true;

		init();

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
		exitSpy.mockRestore();
		process.stdin.isTTY = origStdinTTY;
		process.stdout.isTTY = origStdoutTTY;
	});

	it('exits when only stdout is not TTY', () => {
		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		process.stdin.isTTY = true;
		process.stdout.isTTY = false;

		init();

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
		exitSpy.mockRestore();
		process.stdin.isTTY = origStdinTTY;
		process.stdout.isTTY = origStdoutTTY;
	});
});
