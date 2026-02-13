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

// runtime-forwarded objects (exported as values in JS)
export const prompt: <T = any>(...args: any[]) => Promise<T | null>;
export const spinner: (
	text?: string,
	options?: any,
) => Promise<import('ora').Ora | null>;

// type forwarding for downstream consumers
export type { Ora } from 'ora';
export * from '@inquirer/prompts';
