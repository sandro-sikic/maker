module.exports = {
	testEnvironment: 'node',
	transform: {
		'^.+\\.js$': 'babel-jest',
	},
	// transform @inquirer/prompts (ESM) but ignore other node_modules
	transformIgnorePatterns: ['/node_modules/(?!(?:@inquirer/prompts)/)'],
};
