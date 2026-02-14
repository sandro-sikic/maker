import * as maker from './index.js';

(async () => {
	maker.init();

	const spinner = await maker.spinner('Testing maker.run()...').start();
	maker.save('key', 'test.txt');

	await new Promise((resolve) => setTimeout(resolve, 1000));

	await maker.run('echo "Hello, World!"');

	console.log(maker.load('key'));

	spinner.succeed('Done!');
})();
