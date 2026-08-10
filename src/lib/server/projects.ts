import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { Project } from '$lib/contracts';
import { getDataDirectory, getDataFilePath } from './data-directory.js';

interface ProjectsDocument {
	version: 1;
	projects: Project[];
}

function getProjectsPath(): string {
	return getDataFilePath('projects.json');
}

function isProject(value: unknown): value is Project {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const project = value as Record<string, unknown>;

	return (
		typeof project.id === 'string' &&
		typeof project.name === 'string' &&
		typeof project.cwd === 'string' &&
		typeof project.addedAt === 'string' &&
		typeof project.lastOpenedAt === 'string'
	);
}

async function readDocument(): Promise<ProjectsDocument> {
	try {
		const contents = await readFile(getProjectsPath(), 'utf8');
		const parsed: unknown = JSON.parse(contents);
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Project registry must be an object.');
		}

		const document = parsed as { version?: unknown; projects?: unknown };
		if (
			document.version !== 1 ||
			!Array.isArray(document.projects) ||
			!document.projects.every(isProject)
		) {
			throw new Error('Project registry has an unsupported format.');
		}

		return { version: 1, projects: document.projects };
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return { version: 1, projects: [] };
		}

		throw error;
	}
}

async function writeDocument(document: ProjectsDocument): Promise<void> {
	const directory = getDataDirectory();
	await mkdir(directory, { recursive: true });
	const target = getProjectsPath();
	const temporary = `${target}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600
	});
	await rename(temporary, target);
}

async function canonicalizeDirectory(input: string): Promise<string> {
	if (!input.trim()) {
		throw new Error('A project directory is required.');
	}

	if (!isAbsolute(input)) {
		throw new Error('Project directories must be absolute paths.');
	}

	const cwd = await import('node:fs/promises').then(({ realpath }) => realpath(input));
	const details = await stat(cwd);
	if (!details.isDirectory()) {
		throw new Error('The project path must point to a directory.');
	}

	return cwd;
}

let writes = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
	const result = writes.then(operation, operation);
	writes = result.then(
		() => undefined,
		() => undefined
	);

	return result;
}

export async function listProjects(): Promise<Project[]> {
	const document = await readDocument();

	return [...document.projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function getProject(projectId: string): Promise<Project | undefined> {
	return (await readDocument()).projects.find((project) => project.id === projectId);
}

/**
 * Resolve a registered project again before accessing its filesystem. The registry is
 * user-editable on disk, so its stored path cannot be trusted as canonical indefinitely.
 */
export async function resolveProject(projectId: string): Promise<Project> {
	const project = await getProject(projectId);
	if (!project) {
		throw new Error('Project not found.');
	}

	try {
		return { ...project, cwd: await canonicalizeDirectory(project.cwd) };
	} catch {
		throw new Error('Project directory is unavailable.');
	}
}

export async function addProject(input: { cwd: string; name?: string }): Promise<Project> {
	return serialize(async () => {
		const cwd = await canonicalizeDirectory(input.cwd);
		const document = await readDocument();
		if (document.projects.some((project) => project.cwd === cwd)) {
			throw new Error('That directory is already an added project.');
		}

		const timestamp = new Date().toISOString();
		const project: Project = {
			id: randomUUID(),
			name: input.name?.trim() || basename(cwd),
			cwd,
			addedAt: timestamp,
			lastOpenedAt: timestamp
		};

		document.projects.push(project);
		await writeDocument(document);

		return project;
	});
}

export async function updateProject(projectId: string, input: { name?: string }): Promise<Project> {
	return serialize(async () => {
		const document = await readDocument();
		const project = document.projects.find((candidate) => candidate.id === projectId);
		if (!project) {
			throw new Error('Project not found.');
		}

		if (input.name !== undefined) {
			const name = input.name.trim();
			if (!name) {
				throw new Error('Project names cannot be empty.');
			}

			project.name = name;
		}

		await writeDocument(document);

		return project;
	});
}

export async function removeProject(projectId: string): Promise<void> {
	await serialize(async () => {
		const document = await readDocument();
		const projects = document.projects.filter((project) => project.id !== projectId);
		if (projects.length === document.projects.length) {
			throw new Error('Project not found.');
		}

		await writeDocument({ version: 1, projects });
		const { invalidateProjectFileCache } = await import('./project-files.js');
		invalidateProjectFileCache(projectId);
	});
}

export async function markProjectOpened(projectId: string): Promise<Project> {
	return serialize(async () => {
		const document = await readDocument();
		const project = document.projects.find((candidate) => candidate.id === projectId);
		if (!project) {
			throw new Error('Project not found.');
		}

		project.lastOpenedAt = new Date().toISOString();
		await writeDocument(document);

		return project;
	});
}
