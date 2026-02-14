import { describe, it, expect, vi } from 'vitest';

vi.mock('ora', () => ({
	default: () => ({ start: () => ({ stop: () => {} }) }),
}));

import { run, onExit } from '../index.js';

describe('run()', () => {
	it('captures stdout for successful commands', async () => {
		const res = await run('echo hello');
		expect(res.isError).toBe(false);
		expect(res.code).toBe(0);
		expect(res.stdout).toMatch(/hello/i);
	});

	it('captures stderr and non-zero exit code', async () => {
		const res = await run('node -e "console.error(\'err\'); process.exit(3)"');
		expect(res.isError).toBe(true);
		expect(res.code).toBe(3);
		expect(res.stderr).toMatch(/err/);
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
});
