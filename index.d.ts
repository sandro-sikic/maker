/// <reference path="./storage.generated.d.ts" />

export function init(opts?: { configPath?: string }): void;

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
	opts?: Partial<import('child_process').SpawnOptions> & { maxLines?: number },
): Promise<RunResult>;

export function onExit(cb: () => void | Promise<void>): () => void;

export function save<K extends keyof StorageSchema>(
	key: K,
	value: StorageSchema[K],
): void;

export function save(key: string, value: unknown): void;

export function load<K extends keyof StorageSchema>(key: K): StorageSchema[K];

/**
 * Overload for unknown string keys.
 * @deprecated Key not found in `StorageSchema`. The call is allowed and returns `unknown`.
 */
export function load(key: string): unknown;

export const prompt: typeof import('@inquirer/prompts');

export const spinner: typeof import('ora').default;

export type { Ora } from 'ora';
export * from '@inquirer/prompts';
