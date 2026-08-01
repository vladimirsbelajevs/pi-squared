import { readdir, readFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import ignore from 'ignore';
import type { ProjectFileSuggestion } from '$lib/contracts';
import { resolveProject } from '$lib/server/projects';

const MAX_QUERY_LENGTH = 240;
const MAX_SCANNED_ENTRIES = 20_000;
const MAX_RESULTS = 30;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

interface DirectoryToScan {
	absolutePath: string;
	relativePath: string;
}

interface ScoredPath {
	path: string;
	score: number;
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
	directory: DirectoryToScan
): Promise<void> {
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

/**
 * Lists project-relative files for @ completion. Traversal never follows symlinks
 * and keeps walking ignored directories so a nested negation can re-include a file.
 */
export async function searchProjectFiles(
	projectId: string,
	query: string
): Promise<ProjectFileSuggestion[]> {
	const project = await resolveProject(projectId);
	const normalizedQuery = normalizeQuery(query);
	const ignored = ignore();
	const directories: DirectoryToScan[] = [{ absolutePath: project.cwd, relativePath: '' }];
	const matches: ScoredPath[] = [];
	let scannedEntries = 0;

	while (directories.length && scannedEntries < MAX_SCANNED_ENTRIES) {
		const directory = directories.pop();
		if (!directory) {
			break;
		}

		await addIgnoreFile(ignored, directory);

		let entries;
		try {
			entries = await readdir(directory.absolutePath, { withFileTypes: true });
		} catch {
			continue;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (scannedEntries++ >= MAX_SCANNED_ENTRIES) {
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

			const score = scorePath(relativePath.toLowerCase(), normalizedQuery);
			if (score !== undefined) {
				matches.push({ path: toProjectPath(relativePath), score });
			}
		}
	}

	return matches
		.sort(
			(a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path)
		)
		.slice(0, MAX_RESULTS)
		.map(({ path }) => ({ path }));
}
