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

export function onExit(cb: () => void | Promise<void>): () => void;

export const prompt: typeof import('@inquirer/prompts');
export const spinner: typeof import('ora');

export type { Ora } from 'ora';
export * from '@inquirer/prompts';
