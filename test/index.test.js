import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ora', () => ({
	default: () => ({ start: () => ({ stop: () => {} }) }),
}));

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { run, onExit, init, prompt, spinner, save, load } from '../index.js';

describe('run()', () => {
	it('throws TypeError when command is not a string', async () => {
		await expect(run(null)).rejects.toThrow(TypeError);
		await expect(run(undefined)).rejects.toThrow(TypeError);
		await expect(run(123)).rejects.toThrow(TypeError);
		await expect(run({})).rejects.toThrow(TypeError);
		await expect(run([])).rejects.toThrow(TypeError);
	});

	it('throws TypeError when command is an empty string', async () => {
		await expect(run('')).rejects.toThrow(TypeError);
		await expect(run('')).rejects.toThrow(/non-empty string/);
	});

	it('throws TypeError when command is only whitespace', async () => {
		await expect(run('   ')).rejects.toThrow(TypeError);
		await expect(run('\t\n')).rejects.toThrow(TypeError);
	});

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

	it('throws when passed a non-object argument', () => {
		expect(() => init('some/path/config.cfg')).toThrow(TypeError);
		expect(() => init(123)).toThrow(TypeError);
		expect(() => init(true)).toThrow(TypeError);
		expect(() => init(null)).toThrow(TypeError);
	});

	it('throws when passed an array instead of object', () => {
		expect(() => init([])).toThrow(TypeError);
		expect(() => init(['path'])).toThrow(TypeError);
	});

	it('throws TypeError when configPath is not a string', () => {
		expect(() => init({ configPath: 123 })).toThrow(TypeError);
		expect(() => init({ configPath: {} })).toThrow(TypeError);
		expect(() => init({ configPath: null })).toThrow(TypeError);
		expect(() => init({ configPath: true })).toThrow(TypeError);
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

	it('clears generated storage types file when present', async () => {
		const genPath = path.join(
			path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
			'storage.generated.d.ts',
		);

		// create a dummy generated file
		await fs.writeFile(genPath, '/* generated */', 'utf8');

		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;

		try {
			init();
			let exists = true;
			try {
				await fs.access(genPath);
			} catch (e) {
				exists = false;
			}
			expect(exists).toBe(false);
		} finally {
			process.stdin.isTTY = origStdinTTY;
			process.stdout.isTTY = origStdoutTTY;
			try {
				await fs.rm(genPath);
			} catch (e) {}
		}
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

describe('config: save/load', () => {
	const cfgPath = path.join(
		path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
		'config.json',
	);

	afterEach(async () => {
		try {
			await fs.rm(cfgPath);
		} catch (e) {
			// ignore
		}
	});

	it('creates file and saves/loads primitive value', async () => {
		save('foo', 'bar');
		expect(load('foo')).toBe('bar');
		const txt = await fs.readFile(cfgPath, 'utf8');
		expect(JSON.parse(txt)).toEqual({ foo: 'bar' });
	});

	it('throws TypeError when save() key is not a string', () => {
		expect(() => save(null, 'value')).toThrow(TypeError);
		expect(() => save(undefined, 'value')).toThrow(TypeError);
		expect(() => save(123, 'value')).toThrow(TypeError);
		expect(() => save({}, 'value')).toThrow(TypeError);
		expect(() => save([], 'value')).toThrow(TypeError);
	});

	it('throws TypeError when save() key is an empty string', () => {
		expect(() => save('', 'value')).toThrow(TypeError);
		expect(() => save('', 'value')).toThrow(/non-empty string key/);
	});

	it('throws TypeError when load() key is not a string', () => {
		expect(() => load(null)).toThrow(TypeError);
		expect(() => load(undefined)).toThrow(TypeError);
		expect(() => load(123)).toThrow(TypeError);
		expect(() => load({})).toThrow(TypeError);
		expect(() => load([])).toThrow(TypeError);
	});

	it('throws TypeError when load() key is an empty string', () => {
		expect(() => load('')).toThrow(TypeError);
		expect(() => load('')).toThrow(/non-empty string key/);
	});

	it('saves and loads null values', () => {
		save('nullKey', null);
		expect(load('nullKey')).toBeNull();
	});

	it('saves and loads boolean values', () => {
		save('trueKey', true);
		save('falseKey', false);
		expect(load('trueKey')).toBe(true);
		expect(load('falseKey')).toBe(false);
	});

	it('saves and loads number values including zero and negative', () => {
		save('zero', 0);
		save('negative', -42);
		save('float', 3.14);
		expect(load('zero')).toBe(0);
		expect(load('negative')).toBe(-42);
		expect(load('float')).toBe(3.14);
	});

	it('saves and loads deeply nested objects', () => {
		const nested = {
			level1: {
				level2: {
					level3: {
						value: 'deep',
						array: [1, 2, { nested: true }],
					},
				},
			},
		};
		save('nested', nested);
		expect(load('nested')).toEqual(nested);
	});

	it('saves and loads arrays with mixed types', () => {
		const mixed = [1, 'two', true, null, { key: 'value' }, [1, 2]];
		save('mixedArray', mixed);
		expect(load('mixedArray')).toEqual(mixed);
	});

	it('saves and loads empty arrays and objects', () => {
		save('emptyArray', []);
		save('emptyObject', {});
		expect(load('emptyArray')).toEqual([]);
		expect(load('emptyObject')).toEqual({});
	});

	it('handles keys with special characters', () => {
		save('key-with-dashes', 'value1');
		save('key.with.dots', 'value2');
		save('key_with_underscores', 'value3');
		save('key with spaces', 'value4');
		expect(load('key-with-dashes')).toBe('value1');
		expect(load('key.with.dots')).toBe('value2');
		expect(load('key_with_underscores')).toBe('value3');
		expect(load('key with spaces')).toBe('value4');
	});

	it('handles corrupted JSON file gracefully in load()', async () => {
		const cfgPath = path.join(
			path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
			'config.json',
		);
		await fs.writeFile(cfgPath, '{invalid json', 'utf8');
		expect(() => load('anyKey')).toThrow(SyntaxError);
		await fs.rm(cfgPath);
	});

	it('preserves all keys when saving multiple values', () => {
		save('key1', 'value1');
		save('key2', 'value2');
		save('key3', 'value3');
		expect(load('key1')).toBe('value1');
		expect(load('key2')).toBe('value2');
		expect(load('key3')).toBe('value3');
	});

	it('accepts and returns object values', async () => {
		save('obj', { a: 1, b: 'x' });
		expect(load('obj')).toEqual({ a: 1, b: 'x' });
	});

	it('overwrites existing key', async () => {
		save('k', 'v1');
		save('k', 'v2');
		expect(load('k')).toBe('v2');
	});

	it('returns undefined for missing key or missing file', async () => {
		try {
			await fs.rm(cfgPath);
		} catch (e) {}
		expect(load('nope')).toBeUndefined();
	});

	it('respects config path passed to init(opts)', async () => {
		const origStdinTTY = process.stdin.isTTY;
		const origStdoutTTY = process.stdout.isTTY;
		process.stdin.isTTY = true;
		process.stdout.isTTY = true;

		vi.resetModules();
		const { init: freshInit, save: freshSave } = await import('../index.js');
		const customPath = path.join(
			path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
			'custom-config.cfg',
		);
		try {
			await fs.rm(customPath);
		} catch (e) {}
		freshInit({ configPath: customPath });
		freshSave('customKey', 'value');
		const txt = await fs.readFile(customPath, 'utf8');
		expect(JSON.parse(txt)).toEqual({ customKey: 'value' });
		await fs.rm(customPath);

		process.stdin.isTTY = origStdinTTY;
		process.stdout.isTTY = origStdoutTTY;
	});

	it('handles empty config file in load()', async () => {
		const cfgPath = path.join(
			path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
			'config.json',
		);
		await fs.writeFile(cfgPath, '', 'utf8');
		expect(load('anyKey')).toBeUndefined();
		await fs.rm(cfgPath);
	});

	it('handles whitespace-only config file in load()', async () => {
		const cfgPath = path.join(
			path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
			'config.json',
		);
		await fs.writeFile(cfgPath, '   \n\t  ', 'utf8');
		expect(load('anyKey')).toBeUndefined();
		await fs.rm(cfgPath);
	});
});

describe('type generation (storage.generated.d.ts)', () => {
	const cfgPath = path.join(
		path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
		'config.json',
	);
	const genPath = path.join(
		path.dirname(fileURLToPath(new URL('../index.js', import.meta.url).href)),
		'storage.generated.d.ts',
	);

	afterEach(async () => {
		try {
			await fs.rm(cfgPath);
		} catch (e) {}
		try {
			await fs.rm(genPath);
		} catch (e) {}
	});

	it('generates TypeScript types for string values', async () => {
		save('name', 'John');
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('interface StorageSchema');
		expect(content).toContain('name: string');
	});

	it('generates TypeScript types for number values', async () => {
		save('age', 42);
		save('price', 19.99);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('age: number');
		expect(content).toContain('price: number');
	});

	it('generates TypeScript types for boolean values', async () => {
		save('enabled', true);
		save('disabled', false);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('enabled: boolean');
		expect(content).toContain('disabled: boolean');
	});

	it('generates TypeScript types for null values', async () => {
		save('nullValue', null);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('nullValue: null');
	});

	it('generates TypeScript types for empty arrays', async () => {
		save('emptyArr', []);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('emptyArr: unknown[]');
	});

	it('generates TypeScript types for homogeneous arrays', async () => {
		save('numbers', [1, 2, 3]);
		save('strings', ['a', 'b', 'c']);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('numbers: number[]');
		expect(content).toContain('strings: string[]');
	});

	it('generates TypeScript types for arrays with mixed types', async () => {
		save('mixed', [1, 'two', true]);
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toMatch(/mixed: \(.*\)\[\]/);
		expect(content).toContain('number');
		expect(content).toContain('string');
		expect(content).toContain('boolean');
	});

	it('generates TypeScript types for empty objects', async () => {
		save('emptyObj', {});
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('emptyObj: Record<string, unknown>');
	});

	it('generates TypeScript types for shallow objects', async () => {
		save('user', { name: 'Alice', age: 30, active: true });
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('user:');
		expect(content).toContain('name: string');
		expect(content).toContain('age: number');
		expect(content).toContain('active: boolean');
	});

	it('handles keys with special characters in generated types', async () => {
		save('key-with-dash', 'value');
		save('key with space', 'value');
		const content = await fs.readFile(genPath, 'utf8');
		// Keys that aren't valid identifiers should be quoted
		expect(content).toContain('"key-with-dash": string');
		expect(content).toContain('"key with space": string');
	});

	it('sorts keys alphabetically in generated types', async () => {
		save('zebra', 1);
		save('apple', 2);
		save('banana', 3);
		const content = await fs.readFile(genPath, 'utf8');
		const appleIdx = content.indexOf('apple');
		const bananaIdx = content.indexOf('banana');
		const zebraIdx = content.indexOf('zebra');
		expect(appleIdx).toBeLessThan(bananaIdx);
		expect(bananaIdx).toBeLessThan(zebraIdx);
	});

	it('includes auto-generated comment header', async () => {
		save('test', 'value');
		const content = await fs.readFile(genPath, 'utf8');
		expect(content).toContain('Auto-generated by maker');
		expect(content).toContain('do not edit');
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

	it('handles null stdout and stderr streams gracefully', async () => {
		vi.resetModules();
		vi.doMock('child_process', () => ({
			spawn: () => {
				let closeCb;
				const child = {
					stdout: null,
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
		expect(res.stdout).toBe('');
		expect(res.stderr).toBe('');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('forwards opts including cwd, env, and shell to spawn', async () => {
		vi.resetModules();
		let captured;
		vi.doMock('child_process', () => ({
			spawn: (cmd, spawnOpts) => {
				captured = spawnOpts;
				const child = {
					stdout: { on: () => {} },
					stderr: { on: () => {} },
					on: (ev, cb) => {
						if (ev === 'close') cb(0);
					},
				};
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', {
			cwd: '/tmp',
			env: { FOO: 'bar' },
			maxLines: 5, // Should be filtered out
			shell: false,
		});
		expect(captured.cwd).toBe('/tmp');
		expect(captured.env).toEqual(expect.objectContaining({ FOO: 'bar' }));
		expect(captured.shell).toBe(false);
		expect(captured.stdio).toBe('pipe');
		expect(captured.maxLines).toBeUndefined(); // maxLines should not be forwarded
		expect(res.code).toBe(0);
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

describe('run() - enhanced edge cases', () => {
	it('trims correctly when exceeding maxLines during streaming', async () => {
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
						// Send 15 lines in 3 batches
						stdoutCb(Buffer.from('1\n2\n3\n4\n5\n'));
						stdoutCb(Buffer.from('6\n7\n8\n9\n10\n'));
						stdoutCb(Buffer.from('11\n12\n13\n14\n15\n'));
					}
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', { maxLines: 5 });
		// Should only have last 5 lines
		expect(res.stdout).toMatch(/11/);
		expect(res.stdout).toMatch(/15/);
		expect(res.stdout).not.toMatch(/^1$/m);
		expect(res.stdout).not.toMatch(/^5$/m);
		vi.resetModules();
	});

	it('handles both stdout and stderr with different line counts and trimming', async () => {
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
					// stdout: 10 lines
					if (stdoutCb) {
						stdoutCb(
							Buffer.from(
								Array.from({ length: 10 })
									.map((_, i) => `out${i}`)
									.join('\n') + '\n',
							),
						);
					}
					// stderr: 8 lines
					if (stderrCb) {
						stderrCb(
							Buffer.from(
								Array.from({ length: 8 })
									.map((_, i) => `err${i}`)
									.join('\n') + '\n',
							),
						);
					}
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', { maxLines: 3 });
		expect(res.stdout).toMatch(/out7/);
		expect(res.stdout).toMatch(/out9/);
		expect(res.stdout).not.toMatch(/out0/);
		expect(res.stderr).toMatch(/err5/);
		expect(res.stderr).toMatch(/err7/);
		expect(res.stderr).not.toMatch(/err0/);
		vi.resetModules();
	});

	it('handles output with only newlines', async () => {
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
					if (stdoutCb) stdoutCb(Buffer.from('\n\n\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		// trimToLastNLines removes trailing newlines, processes lines, then adds back one
		expect(res.stdout).toBe('\n');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('handles empty stdout and stderr', async () => {
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
		expect(res.stdout).toBe('');
		expect(res.stderr).toBe('');
		expect(res.output).toBe('');
		expect(res.isError).toBe(false);
		vi.resetModules();
	});

	it('handles very long single line without newline', async () => {
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
					if (stdoutCb) stdoutCb(Buffer.from('x'.repeat(10000)));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout.length).toBe(10000);
		expect(res.stdout).toBe('x'.repeat(10000));
		vi.resetModules();
	});

	it('properly handles exit code 127 (command not found)', async () => {
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
					if (stderrCb) stderrCb(Buffer.from('command not found\n'));
					if (closeCb) closeCb(127);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('nonexistent-cmd');
		expect(res.isError).toBe(true);
		expect(res.code).toBe(127);
		expect(res.stderr).toMatch(/command not found/);
		vi.resetModules();
	});

	it('handles alternating stdout/stderr chunks', async () => {
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
					if (stdoutCb) stdoutCb(Buffer.from('out1\n'));
					if (stderrCb) stderrCb(Buffer.from('err1\n'));
					if (stdoutCb) stdoutCb(Buffer.from('out2\n'));
					if (stderrCb) stderrCb(Buffer.from('err2\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout).toContain('out1');
		expect(res.stdout).toContain('out2');
		expect(res.stderr).toContain('err1');
		expect(res.stderr).toContain('err2');
		expect(res.output).toContain('out1');
		expect(res.output).toContain('err1');
		vi.resetModules();
	});

	it('handles maxLines of 1 correctly', async () => {
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
					if (stdoutCb) stdoutCb(Buffer.from('line1\nline2\nline3\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', { maxLines: 1 });
		expect(res.stdout).toBe('line3\n');
		expect(res.stdout).not.toContain('line1');
		expect(res.stdout).not.toContain('line2');
		vi.resetModules();
	});

	it('handles mixed line endings (LF and CRLF)', async () => {
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
					if (stdoutCb) stdoutCb(Buffer.from('unix\nwindows\r\nunix2\n'));
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything');
		expect(res.stdout).toContain('unix\n');
		expect(res.stdout).toContain('windows\r\n');
		expect(res.stdout).toContain('unix2');
		vi.resetModules();
	});

	it('handles trailing multiple newlines correctly when trimming', async () => {
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
						// 10 lines followed by multiple trailing newlines
						stdoutCb(
							Buffer.from(
								Array.from({ length: 10 })
									.map((_, i) => i)
									.join('\n') + '\n\n\n\n',
							),
						);
					}
					if (closeCb) closeCb(0);
				});
				return child;
			},
		}));
		const { run: mockedRun } = await import('../index.js');
		const res = await mockedRun('anything', { maxLines: 5 });
		expect(res.stdout).toMatch(/5/);
		expect(res.stdout).toMatch(/9/);
		// Trailing newline should be preserved
		expect(res.stdout).toMatch(/\n$/);
		vi.resetModules();
	});
});

describe('onExit() - enhanced edge cases', () => {
	it('handles callback throwing synchronously', async () => {
		const cb = vi.fn(() => {
			throw new Error('sync error');
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGINT');
		await new Promise((r) => setTimeout(r, 10));
		expect(cb).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			'onExit callback error:',
			expect.any(Error),
		);
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		consoleSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it('handles spinner that does not have a stop method', async () => {
		const mockSpinner = vi.fn(() => ({ start: () => ({}) })); // No stop method

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

		// Should not throw, should still exit
		expect(cb).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);

		off();
		exitSpy.mockRestore();
		vi.resetModules();
	});

	it('throws TypeError with descriptive message for non-function', () => {
		expect(() => onExit(null)).toThrow(TypeError);
		expect(() => onExit(null)).toThrow('onExit requires a callback function');
		expect(() => onExit(undefined)).toThrow(TypeError);
		expect(() => onExit('string')).toThrow(TypeError);
		expect(() => onExit({})).toThrow(TypeError);
	});

	it('can be called with an async arrow function', async () => {
		const cb = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 5));
		});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGTERM'); // Test different signal
		await new Promise((r) => setTimeout(r, 15));
		expect(cb).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		exitSpy.mockRestore();
	});

	it('responds to SIGQUIT signal', async () => {
		const cb = vi.fn(async () => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const off = onExit(cb);
		process.emit('SIGQUIT');
		await new Promise((r) => setTimeout(r, 10));
		expect(cb).toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(0);
		off();
		exitSpy.mockRestore();
	});

	it('unsubscribe can be called multiple times safely', () => {
		const cb = vi.fn();
		const off = onExit(cb);
		off(); // First unsubscribe
		off(); // Second unsubscribe - should not throw
		process.emit('SIGINT');
		expect(cb).not.toHaveBeenCalled();
	});
});

describe('prompt and spinner re-exports', () => {
	it('prompt re-export handles default export', () => {
		expect(prompt).toBeDefined();
		// prompt should be the inquirer object or its default
		expect(typeof prompt).toBeTruthy();
	});

	it('spinner creates a spinner with correct API', () => {
		const s = spinner('Loading...');
		expect(s).toBeDefined();
		expect(typeof s.start).toBe('function');
		const started = s.start();
		expect(typeof started.stop).toBe('function');
	});

	it('spinner can be started and stopped multiple times', () => {
		const s = spinner('Test');
		const started1 = s.start();
		started1.stop();
		const started2 = s.start();
		expect(typeof started2.stop).toBe('function');
	});
});
