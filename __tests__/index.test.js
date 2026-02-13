const maker = require('../index');

describe('maker module', () => {
	describe('init()', () => {
		let origStdinIsTTY;
		let origStdoutIsTTY;
		let exitSpy;

		beforeEach(() => {
			origStdinIsTTY = process.stdin.isTTY;
			origStdoutIsTTY = process.stdout.isTTY;
			exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
		});

		afterEach(() => {
			process.stdin.isTTY = origStdinIsTTY;
			process.stdout.isTTY = origStdoutIsTTY;
			exitSpy.mockRestore();
		});

		test('exits with code 1 when not running in a TTY', () => {
			process.stdin.isTTY = false;
			process.stdout.isTTY = false;
			maker.init();
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		test('does not exit when running in a TTY', () => {
			process.stdin.isTTY = true;
			process.stdout.isTTY = true;
			maker.init();
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	describe('run()', () => {
		jest.setTimeout(10000);

		test('resolves stdout and exit code on success', async () => {
			const res = await maker.run('echo hello-from-run');
			expect(res.code).toBe(0);
			expect(res.isError).toBe(false);
			expect(res.stdout).toMatch(/hello-from-run/);
		});

		test('reports non-zero exit code', async () => {
			const res = await maker.run('node -e "process.exit(3)"');
			expect(res.code).toBe(3);
			expect(res.isError).toBe(true);
		});
	});

	describe('onExit()', () => {
		afterEach(() => {
			// ensure no stray listeners between tests
			process.removeAllListeners('SIGINT');
		});

		test('throws if callback is not a function', () => {
			expect(() => maker.onExit(null)).toThrow(TypeError);
		});

		test('runs callback on SIGINT and exits after awaiting it', async () => {
			const cb = jest.fn(async () => {
				// simulate async cleanup
				await Promise.resolve();
			});
			const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

			const dispose = maker.onExit(cb);

			process.emit('SIGINT');
			// wait for async handler to complete
			await new Promise((r) => setImmediate(r));

			expect(cb).toHaveBeenCalledTimes(1);
			expect(exitSpy).toHaveBeenCalledWith(0);

			dispose();
			exitSpy.mockRestore();
		});

		test('disposer removes the SIGINT listener', async () => {
			const cb = jest.fn();
			const dispose = maker.onExit(cb);
			dispose();

			process.emit('SIGINT');
			// allow any async microtasks to run
			await new Promise((r) => setImmediate(r));
			expect(cb).not.toHaveBeenCalled();
		});

		test('callback is invoked only once for repeated SIGINTs', async () => {
			const cb = jest.fn();
			const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
			const dispose = maker.onExit(cb);

			process.emit('SIGINT');
			process.emit('SIGINT');
			await new Promise((r) => setImmediate(r));

			expect(cb).toHaveBeenCalledTimes(1);
			expect(exitSpy).toHaveBeenCalledTimes(1);

			dispose();
			exitSpy.mockRestore();
		});
	});

	describe('public API', () => {
		test('exports only prompt and spinner for runtime helpers', () => {
			expect(typeof maker.prompt).toBe('function');
			expect(typeof maker.spinner).toBe('function');
			expect(maker.getPrompt).toBeUndefined();
			expect(maker.getSpinner).toBeUndefined();
		});
	});
});
