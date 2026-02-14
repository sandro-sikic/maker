import * as maker from './index.js';

(async () => {
	maker.init();

	const spinner = await maker.spinner('Testing maker.run()...').start();

	await new Promise((resolve) => setTimeout(resolve, 1000));

	await maker.run('echo "Hello, World!"');

	spinner.succeed('Done!');
})();
