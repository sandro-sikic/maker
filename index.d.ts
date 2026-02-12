export function init(): void;

export type RunResult = {
	output: string;
	stdout: string;
	stderr: string;
	code: number | null;
	isError: boolean;
	error: Error | null;
};

export function run(
	command: string,
	opts?: { maxLines?: number },
): Promise<RunResult>;

// runtime-forwarded objects (exported as values in JS)
export const prompt: typeof import('@inquirer/prompts');
export const spinner: typeof import('ora');

// type forwarding for downstream consumers
export type { Ora } from 'ora';
export * from '@inquirer/prompts';
