import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import ignore from 'ignore';
import type { ProjectFileSuggestion } from '$lib/contracts';
import { resolveProject } from '$lib/server/projects';

const MAX_QUERY_LENGTH = 240;
const MAX_SCANNED_ENTRIES = 20_000;
const MAX_INDEXED_FILES = 20_000;
const MAX_RESULTS = 30;
export const PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES = 32;
export const PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS = 4;
export const PROJECT_FILE_INDEX_MAX_QUEUED_BUILDS = 64;

/**
 * A project file index is retained for 30 seconds. This keeps normal autocomplete
 * queries in memory while allowing newly created files to appear without an explicit
 * invalidation signal from the editor.
 */
export const PROJECT_FILE_INDEX_TTL_MS = 30_000;
const MAX_GIT_CANDIDATES = 20_000;
const MAX_GIT_PATH_BYTES = 1 * 1024 * 1024;
const MAX_GIT_PROBE_OUTPUT_BYTES = 16 * 1024;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

type FileIndex = {
	paths: string[];
	builtAt: number;
	lastAccessedAt: number;
};

type IndexBuild = {
	key: string;
	root: string;
	controller: AbortController;
	waiters: number;
	state: 'queued' | 'running' | 'finished';
	finished: boolean;
	promise: Promise<FileIndex>;
	resolve: (index: FileIndex) => void;
	reject: (error: unknown) => void;
};

type ProjectState = {
	root: string;
	token: object;
	activeSearches: number;
};

export type ProjectFileSearchResult = {
	files: ProjectFileSuggestion[];
	freshForMs: number;
};

/** Narrow async seam used by race tests; unset during normal application operation. */
export type ProjectFileTestHooks = {
	beforeCandidateRevalidation?: (root: string, path: string) => void | Promise<void>;
	onIndexBuildEnqueued?: (root: string) => void;
	onIndexBuildStarted?: (root: string) => void;
};

interface DirectoryToScan {
	absolutePath: string;
	relativePath: string;
}

interface ScoredPath {
	path: string;
	score: number;
}

const indexes = new Map<string, FileIndex>();
const builds = new Map<string, IndexBuild>();
const queuedBuilds: IndexBuild[] = [];
const projectStates = new Map<string, ProjectState>();
let projectFileTestHooks: ProjectFileTestHooks | undefined;
let activeBuildCount = 0;
let buildCount = 0;

function createAbortError(): Error {
	const error = new Error('File search was aborted.');
	error.name = 'AbortError';

	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

class GitAutocompleteError extends Error {
	constructor(
		readonly operation: string,
		readonly diagnostic: string,
		readonly root: string
	) {
		super('Project file autocomplete is unavailable.');
		this.name = 'GitAutocompleteError';
	}
}

function boundedDiagnostic(value: string): string {
	return value.replaceAll(/\s+/g, ' ').trim().slice(0, 4096);
}

function logGitFailure(error: GitAutocompleteError): void {
	console.error('Project file autocomplete Git operation failed.', {
		operation: error.operation,
		root: error.root,
		diagnostic: error.diagnostic
	});
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
}

function toProjectPath(path: string): string {
	return path.split(sep).join('/');
}

function normalizeQuery(query: string): string {
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error('File query is too long.');
	}

	return query.trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function prefixIgnorePattern(pattern: string, directory: string): string | undefined {
	const trimmed = pattern.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return undefined;
	}

	const negated = trimmed.startsWith('!');
	const body = (negated ? trimmed.slice(1) : trimmed).replace(/^\//, '');
	if (!body) {
		return undefined;
	}

	if (!directory) {
		return `${negated ? '!' : ''}${body}`;
	}

	const scoped = body.includes('/') ? body : `**/${body}`;

	return `${negated ? '!' : ''}${directory}/${scoped}`;
}

async function addIgnoreFile(
	ignored: ReturnType<typeof ignore>,
	directory: DirectoryToScan,
	signal: AbortSignal
): Promise<void> {
	throwIfAborted(signal);
	try {
		const contents = await readFile(join(directory.absolutePath, '.gitignore'), 'utf8');
		const patterns = contents
			.split(/\r?\n/)
			.map((line) => prefixIgnorePattern(line, directory.relativePath))
			.filter((pattern): pattern is string => pattern !== undefined);
		if (patterns.length) {
			ignored.add(patterns);
		}
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
			return;
		}
	}
}

function scorePath(path: string, query: string): number | undefined {
	if (!query) {
		return 7;
	}

	const name = basename(path).toLowerCase();
	if (path === query) {
		return 0;
	}

	if (path.startsWith(query)) {
		return 1;
	}

	if (name.startsWith(query)) {
		return 2;
	}

	if (path.includes(`/${query}`)) {
		return 3;
	}

	if (name.includes(query)) {
		return 4;
	}

	if (path.includes(query)) {
		return 5;
	}

	return undefined;
}

function isIgnored(ignored: ReturnType<typeof ignore>, path: string): boolean {
	try {
		return ignored.ignores(path);
	} catch {
		return false;
	}
}

function cacheKey(projectId: string, root: string): string {
	return `${projectId}\u0000${root}`;
}

function projectIdFromCacheKey(key: string): string {
	return key.slice(0, key.indexOf('\u0000'));
}

function isInsideRoot(root: string, candidate: string): boolean {
	const resolved = relative(root, candidate);

	return (
		resolved !== '' &&
		resolved !== '..' &&
		!resolved.startsWith(`..${sep}`) &&
		!isAbsolute(resolved)
	);
}

/**
 * Validate a candidate returned by Git or the fallback traversal before putting it
 * into the index. Git can report deleted tracked files and tracked symlinks, while a
 * concurrent filesystem change can make a fallback entry disappear.
 */
export async function validateProjectFileCandidate(
	root: string,
	candidate: string,
	signal?: AbortSignal
): Promise<string | undefined> {
	throwIfAborted(signal);
	if (!candidate || candidate.includes('\0')) {
		return undefined;
	}

	const candidatePath = candidate.split('/').join(sep);
	if (candidatePath.split(sep).some((segment) => segment === '..')) {
		return undefined;
	}

	if (isAbsolute(candidatePath)) {
		return undefined;
	}

	const absolutePath = join(root, candidatePath);
	if (!isInsideRoot(root, absolutePath)) {
		return undefined;
	}

	try {
		const relativePath = relative(root, absolutePath);
		const segments = relativePath.split(sep);
		let currentPath = root;
		for (const [index, segment] of segments.entries()) {
			currentPath = join(currentPath, segment);
			const details = await lstat(currentPath);
			if (details.isSymbolicLink()) {
				return undefined;
			}

			if (index === segments.length - 1 ? !details.isFile() : !details.isDirectory()) {
				return undefined;
			}
		}

		const canonicalPath = await realpath(absolutePath);
		if (!isInsideRoot(root, canonicalPath)) {
			return undefined;
		}

		return toProjectPath(relative(root, absolutePath));
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		return undefined;
	}
}

export function setProjectFileTestHooks(hooks: ProjectFileTestHooks | undefined): void {
	projectFileTestHooks = hooks;
}

function stopGitChild(child: ReturnType<typeof spawn>): void {
	if (child.exitCode === null && child.signalCode === null) {
		child.kill();
	}
}

async function hasGitMarker(root: string, signal: AbortSignal): Promise<boolean> {
	let current = root;
	while (true) {
		throwIfAborted(signal);
		try {
			await lstat(join(current, '.git'));

			return true;
		} catch (error) {
			if (isAbortError(error, signal)) {
				throw createAbortError();
			}
		}

		const parent = dirname(current);
		if (parent === current) {
			return false;
		}

		current = parent;
	}
}

async function probeGitRepository(root: string, signal: AbortSignal): Promise<boolean> {
	throwIfAborted(signal);
	const child = spawn('git', ['rev-parse', '--is-inside-work-tree'], {
		cwd: root,
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' },
		signal
	});
	if (!child.stdout || !child.stderr) {
		throw new GitAutocompleteError('probe', 'Git probe did not provide output streams.', root);
	}

	let stdout = Buffer.alloc(0);
	let stderr = '';
	let tooMuchOutput = false;
	let childError: Error | undefined;
	child.stdout.on('data', (chunk: Buffer | string) => {
		if (tooMuchOutput) {
			return;
		}

		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		const remaining = MAX_GIT_PROBE_OUTPUT_BYTES - stdout.length;
		if (bytes.length > remaining) {
			stdout = Buffer.concat([stdout, bytes.subarray(0, remaining)]);
			tooMuchOutput = true;
			stopGitChild(child);

			return;
		}

		stdout = Buffer.concat([stdout, bytes]);
	});
	child.stderr.on('data', (chunk: Buffer | string) => {
		if (stderr.length < 4096) {
			stderr += chunk.toString().slice(0, 4096 - stderr.length);
		}
	});
	child.on('error', (error) => {
		childError = error;
	});

	const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
		(resolve) => {
			child.once('close', (code, signalCode) => resolve({ code, signal: signalCode }));
		}
	);
	if (isAbortError(childError, signal)) {
		throw createAbortError();
	}

	if (signal.aborted) {
		throw createAbortError();
	}

	if (tooMuchOutput) {
		throw new GitAutocompleteError('probe', 'Git probe output exceeded its bound.', root);
	}

	if (childError) {
		const code = 'code' in childError ? childError.code : undefined;
		if (code === 'ENOENT' && !(await hasGitMarker(root, signal))) {
			return false;
		}

		throw new GitAutocompleteError(
			'probe',
			`${childError.message}${stderr ? ` ${boundedDiagnostic(stderr)}` : ''}`,
			root
		);
	}

	if (exit.code === 0) {
		const result = stdout.toString('utf8').trim();
		if (result === 'true') {
			return true;
		}

		if (result === 'false') {
			return false;
		}

		throw new GitAutocompleteError(
			'probe',
			`Unexpected Git probe output: ${boundedDiagnostic(stdout.toString('utf8'))}`,
			root
		);
	}

	const diagnostic = boundedDiagnostic(stderr);
	if (/not a git repository|outside a repository|must be run in a work tree/i.test(diagnostic)) {
		return false;
	}

	throw new GitAutocompleteError(
		'probe',
		`Git probe exited with ${String(exit.code)}.${diagnostic ? ` ${diagnostic}` : ''}`,
		root
	);
}

function decodeGitPath(value: Buffer, root: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(value);
	} catch {
		throw new GitAutocompleteError('listing', 'Git returned invalid UTF-8 path data.', root);
	}
}

/**
 * Read Git's NUL-delimited output incrementally. The child is deliberately stopped
 * after the candidate bound, rather than buffering an unbounded listing or allowing
 * execFile's maxBuffer failure to silently change Git ignore semantics.
 */
async function runGit(root: string, signal: AbortSignal): Promise<string[]> {
	throwIfAborted(signal);
	const child = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
		cwd: root,
		shell: false,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' },
		signal
	});
	if (!child.stdout || !child.stderr) {
		throw new GitAutocompleteError(
			'listing',
			'Git file listing did not provide output streams.',
			root
		);
	}

	const paths: string[] = [];
	const seen = new Set<string>();
	let buffered = Buffer.alloc(0);
	let candidateCount = 0;
	let deliberatelyStopped = false;
	let stderr = '';
	let childError: Error | undefined;
	child.on('error', (error) => {
		childError = error;
	});
	child.stderr.on('data', (chunk: Buffer | string) => {
		if (stderr.length < 4096) {
			stderr += chunk.toString().slice(0, 4096 - stderr.length);
		}
	});
	const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
		(resolve) => {
			child.once('close', (code, signalCode) => resolve({ code, signal: signalCode }));
		}
	);

	try {
		for await (const chunk of child.stdout) {
			throwIfAborted(signal);
			buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
			if (buffered.length > MAX_GIT_PATH_BYTES) {
				throw new GitAutocompleteError(
					'listing',
					'Git returned an excessively long file path.',
					root
				);
			}

			while (true) {
				const separator = buffered.indexOf(0);
				if (separator === -1) {
					break;
				}

				const candidate = decodeGitPath(buffered.subarray(0, separator), root);
				buffered = buffered.subarray(separator + 1);
				candidateCount += 1;
				const path = await validateProjectFileCandidate(root, candidate, signal);
				if (path && !seen.has(path)) {
					seen.add(path);
					paths.push(path);
				}

				if (candidateCount >= MAX_GIT_CANDIDATES) {
					deliberatelyStopped = true;
					stopGitChild(child);
					break;
				}
			}

			if (deliberatelyStopped) {
				break;
			}
		}

		if (!deliberatelyStopped && buffered.length) {
			throw new GitAutocompleteError(
				'listing',
				'Git file listing ended with an unterminated path.',
				root
			);
		}

		if (deliberatelyStopped) {
			return paths.sort((a, b) => a.localeCompare(b));
		}

		const exit = await exitPromise;
		if (childError) {
			const code = 'code' in childError ? childError.code : undefined;
			throw new GitAutocompleteError(
				'listing',
				`${childError.message}${code ? ` (${String(code)})` : ''}${stderr ? ` ${boundedDiagnostic(stderr)}` : ''}`,
				root
			);
		}

		if (exit.code !== 0) {
			throw new GitAutocompleteError(
				'listing',
				`Git file listing exited with ${String(exit.code)}.${stderr ? ` ${boundedDiagnostic(stderr)}` : ''}`,
				root
			);
		}

		return paths.sort((a, b) => a.localeCompare(b));
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		throw error;
	} finally {
		if (!deliberatelyStopped) {
			stopGitChild(child);
		}
	}
}

/**
 * Git includes tracked files even when an ignore rule matches them. `--exclude-standard`
 * applies to untracked files only, so this intentionally differs from the fallback's
 * ignore-aware traversal, which has no Git index to distinguish tracked files.
 */
async function buildGitIndex(root: string, signal: AbortSignal): Promise<string[] | undefined> {
	const isGitRepository = await probeGitRepository(root, signal);
	if (!isGitRepository) {
		return undefined;
	}

	return runGit(root, signal);
}

async function buildFallbackIndex(root: string, signal: AbortSignal): Promise<string[]> {
	const ignored = ignore();
	const directories: DirectoryToScan[] = [{ absolutePath: root, relativePath: '' }];
	const paths: string[] = [];
	let scannedEntries = 0;

	while (
		directories.length &&
		scannedEntries < MAX_SCANNED_ENTRIES &&
		paths.length < MAX_INDEXED_FILES
	) {
		throwIfAborted(signal);
		const directory = directories.pop();
		if (!directory) {
			break;
		}

		await addIgnoreFile(ignored, directory, signal);

		let entries;
		try {
			entries = await readdir(directory.absolutePath, { withFileTypes: true });
		} catch (error) {
			if (isAbortError(error, signal)) {
				throw createAbortError();
			}

			continue;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (scannedEntries++ >= MAX_SCANNED_ENTRIES || paths.length >= MAX_INDEXED_FILES) {
				break;
			}

			const relativePath = directory.relativePath
				? `${directory.relativePath}/${entry.name}`
				: entry.name;
			const absolutePath = join(directory.absolutePath, entry.name);

			if (entry.isSymbolicLink()) {
				continue;
			}

			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					directories.push({ absolutePath, relativePath });
				}

				continue;
			}

			if (!entry.isFile() || isIgnored(ignored, relativePath)) {
				continue;
			}

			const path = await validateProjectFileCandidate(root, relativePath, signal);
			if (path) {
				paths.push(path);
			}
		}
	}

	return paths.sort((a, b) => a.localeCompare(b));
}

async function buildIndex(root: string, signal: AbortSignal): Promise<FileIndex> {
	try {
		const paths = (await buildGitIndex(root, signal)) ?? (await buildFallbackIndex(root, signal));
		const now = Date.now();

		return { paths, builtAt: now, lastAccessedAt: now };
	} catch (error) {
		if (isAbortError(error, signal)) {
			throw createAbortError();
		}

		if (error instanceof GitAutocompleteError) {
			logGitFailure(error);
			throw new Error('Project file autocomplete is unavailable.', { cause: error });
		}

		throw error;
	}
}

function hasProjectActivity(projectId: string): boolean {
	for (const key of indexes.keys()) {
		if (projectIdFromCacheKey(key) === projectId) {
			return true;
		}
	}

	for (const key of builds.keys()) {
		if (projectIdFromCacheKey(key) === projectId) {
			return true;
		}
	}

	return false;
}

function maybeCleanupProjectState(projectId: string): void {
	const state = projectStates.get(projectId);
	if (state && state.activeSearches === 0 && !hasProjectActivity(projectId)) {
		projectStates.delete(projectId);
	}
}

function storeIndex(key: string, index: FileIndex): void {
	indexes.set(key, index);
	while (indexes.size > PROJECT_FILE_INDEX_MAX_CACHE_ENTRIES) {
		const oldest = [...indexes.entries()].sort(
			([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt
		)[0];
		if (!oldest) {
			break;
		}

		indexes.delete(oldest[0]);
		maybeCleanupProjectState(projectIdFromCacheKey(oldest[0]));
	}
}

function removeQueuedBuild(build: IndexBuild): void {
	const index = queuedBuilds.indexOf(build);
	if (index !== -1) {
		queuedBuilds.splice(index, 1);
	}

	build.state = 'finished';
	build.finished = true;
	if (builds.get(build.key) === build) {
		builds.delete(build.key);
	}

	build.reject(createAbortError());
	maybeCleanupProjectState(projectIdFromCacheKey(build.key));
}

function pumpBuildQueue(): void {
	while (activeBuildCount < PROJECT_FILE_INDEX_MAX_ACTIVE_BUILDS && queuedBuilds.length) {
		const build = queuedBuilds.shift();
		if (!build || build.state !== 'queued' || builds.get(build.key) !== build) {
			continue;
		}

		if (build.waiters === 0) {
			removeQueuedBuild(build);
			continue;
		}

		build.state = 'running';
		activeBuildCount += 1;
		buildCount += 1;
		projectFileTestHooks?.onIndexBuildStarted?.(build.root);
		void buildIndex(build.root, build.controller.signal)
			.then((index) => {
				if (!build.controller.signal.aborted) {
					storeIndex(build.key, index);
				}

				build.resolve(index);
			})
			.catch((error) => {
				build.reject(error);
			})
			.finally(() => {
				build.state = 'finished';
				build.finished = true;
				activeBuildCount -= 1;
				if (builds.get(build.key) === build) {
					builds.delete(build.key);
				}

				maybeCleanupProjectState(projectIdFromCacheKey(build.key));
				pumpBuildQueue();
			});
	}
}

function releaseBuildWaiter(build: IndexBuild): void {
	build.waiters -= 1;
	if (build.waiters === 0 && !build.finished) {
		if (build.state === 'queued') {
			removeQueuedBuild(build);
			pumpBuildQueue();
		} else {
			build.controller.abort();
		}
	}
}

function waitForBuild(build: IndexBuild, signal?: AbortSignal): Promise<FileIndex> {
	throwIfAborted(signal);
	build.waiters += 1;

	return new Promise<FileIndex>((resolvePromise, rejectPromise) => {
		let settled = false;
		const settle = (settler: () => void) => {
			if (settled) {
				return;
			}

			settled = true;
			signal?.removeEventListener('abort', onAbort);
			releaseBuildWaiter(build);
			settler();
		};

		const onAbort = () => settle(() => rejectPromise(createAbortError()));

		signal?.addEventListener('abort', onAbort, { once: true });
		build.promise.then(
			(index) => settle(() => resolvePromise(index)),
			(error) => settle(() => rejectPromise(error))
		);
	});
}

async function getIndex(projectId: string, root: string, signal?: AbortSignal): Promise<FileIndex> {
	throwIfAborted(signal);
	const key = cacheKey(projectId, root);
	const cached = indexes.get(key);
	if (cached && Date.now() - cached.builtAt < PROJECT_FILE_INDEX_TTL_MS) {
		cached.lastAccessedAt = Date.now();

		return cached;
	}

	if (cached) {
		indexes.delete(key);
		maybeCleanupProjectState(projectId);
	}

	const existing = builds.get(key);
	if (existing) {
		return waitForBuild(existing, signal);
	}

	if (queuedBuilds.length >= PROJECT_FILE_INDEX_MAX_QUEUED_BUILDS) {
		throw new Error('Project file autocomplete is busy.');
	}

	const deferred = createDeferred<FileIndex>();
	const build: IndexBuild = {
		key,
		root,
		controller: new AbortController(),
		waiters: 0,
		state: 'queued',
		finished: false,
		promise: deferred.promise,
		resolve: deferred.resolve,
		reject: deferred.reject
	};
	builds.set(key, build);
	projectFileTestHooks?.onIndexBuildEnqueued?.(root);
	const result = waitForBuild(build, signal);
	queuedBuilds.push(build);
	pumpBuildQueue();

	// The shared promise can reject after every waiter has aborted. Keep that
	// cancellation from becoming an unhandled rejection while waiters still receive it.
	void build.promise.catch(() => undefined);

	return result;
}

/** Evict all cached and in-flight indexes belonging to a removed or moved project. */
export function invalidateProjectFileCache(projectId: string): void {
	// Deleting the opaque token revokes every request that captured the previous
	// state, even if it retained a completed FileIndex object locally.
	projectStates.delete(projectId);
	for (const [key] of indexes) {
		if (projectIdFromCacheKey(key) === projectId) {
			indexes.delete(key);
		}
	}

	for (const build of [...builds.values()]) {
		if (projectIdFromCacheKey(build.key) !== projectId) {
			continue;
		}

		if (build.state === 'queued') {
			removeQueuedBuild(build);
		} else {
			build.controller.abort();
		}
	}

	pumpBuildQueue();
}

/** Test/diagnostic helper; production callers normally rely on TTL and LRU eviction. */
export function clearProjectFileCache(): void {
	projectFileTestHooks = undefined;
	for (const build of [...builds.values()]) {
		if (build.state === 'queued') {
			removeQueuedBuild(build);
		} else {
			build.controller.abort();
		}
	}

	queuedBuilds.length = 0;
	indexes.clear();
	builds.clear();
	projectStates.clear();
	buildCount = 0;
}

export function getProjectFileCacheStats(): {
	cacheEntries: number;
	cachedFiles: number;
	inFlightBuilds: number;
	inFlightWaiters: number;
	activeBuilds: number;
	queuedBuilds: number;
	invalidationStates: number;
	buildCount: number;
} {
	return {
		cacheEntries: indexes.size,
		cachedFiles: [...indexes.values()].reduce((total, index) => total + index.paths.length, 0),
		inFlightBuilds: builds.size,
		inFlightWaiters: [...builds.values()].reduce((total, build) => total + build.waiters, 0),
		activeBuilds: activeBuildCount,
		queuedBuilds: queuedBuilds.length,
		invalidationStates: projectStates.size,
		buildCount
	};
}

/**
 * Lists project-relative files for @ completion. The filesystem is indexed once per
 * project/root and queries are ranked in memory until the short index TTL expires.
 */
export async function searchProjectFiles(
	projectId: string,
	query: string,
	signal?: AbortSignal
): Promise<ProjectFileSearchResult> {
	throwIfAborted(signal);
	const normalizedQuery = normalizeQuery(query);
	let project;
	try {
		project = await resolveProject(projectId);
	} catch (error) {
		invalidateProjectFileCache(projectId);
		throw error;
	}

	let state = projectStates.get(projectId);
	if (state && state.root !== project.cwd) {
		// Advance the token before starting a replacement-root build. Requests that
		// retained the previous completed index fail their next generation check.
		invalidateProjectFileCache(projectId);
		state = undefined;
	}

	if (!state) {
		state = { root: project.cwd, token: {}, activeSearches: 0 };
		projectStates.set(projectId, state);
	}

	state.activeSearches += 1;
	const token = state.token;

	try {
		const index = await getIndex(project.id, project.cwd, signal);
		if (projectStates.get(projectId)?.token !== token) {
			throw createAbortError();
		}

		throwIfAborted(signal);
		const matches: ScoredPath[] = [];
		for (const path of index.paths) {
			if (projectStates.get(projectId)?.token !== token) {
				throw createAbortError();
			}

			const score = scorePath(path.toLowerCase(), normalizedQuery);
			if (score !== undefined) {
				matches.push({ path, score });
			}
		}

		index.lastAccessedAt = Date.now();
		const rankedMatches = matches.sort(
			(a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path)
		);
		const validMatches: ProjectFileSuggestion[] = [];
		for (const { path } of rankedMatches) {
			if (validMatches.length >= MAX_RESULTS) {
				break;
			}

			if (projectStates.get(projectId)?.token !== token) {
				throw createAbortError();
			}

			await projectFileTestHooks?.beforeCandidateRevalidation?.(project.cwd, path);
			const validPath = await validateProjectFileCandidate(project.cwd, path, signal);
			if (projectStates.get(projectId)?.token !== token) {
				throw createAbortError();
			}

			if (validPath) {
				validMatches.push({ path: validPath });
			}
		}

		if (projectStates.get(projectId)?.token !== token) {
			throw createAbortError();
		}

		throwIfAborted(signal);

		return {
			files: validMatches,
			freshForMs: Math.max(0, PROJECT_FILE_INDEX_TTL_MS - (Date.now() - index.builtAt))
		};
	} finally {
		const currentState = projectStates.get(projectId);
		if (currentState?.token === token) {
			currentState.activeSearches -= 1;
			maybeCleanupProjectState(projectId);
		}
	}
}
