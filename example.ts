import * as maker from './index.js';

(async () => {
	maker.init();

	maker.save('test key', 'test.txt');
	maker.save('key test', 'test.txt');

	const answer = await maker.prompt.confirm({
		message: 'Do you want to continue?',
	});

	const processing = await maker.spinner('Processing...').start();
	console.log('Answer:', answer);

	await new Promise((resolve) => setTimeout(resolve, 1000));

	await maker.run('echo "Hello, World!"');

	processing.succeed();

	console.log(maker.load('key test'));
	console.log(maker.load('test key'));
})();
