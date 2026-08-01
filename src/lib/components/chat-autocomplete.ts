export type SlashCommandSuggestion = {
	name: string;
	description?: string;
	source: 'extension' | 'prompt' | 'skill';
};

export type SlashCommandToken = {
	kind: 'command';
	start: number;
	end: number;
	query: string;
};

export type FileAutocompleteToken = {
	kind: 'file';
	start: number;
	end: number;
	query: string;
};

export type ChatAutocompleteToken = SlashCommandToken | FileAutocompleteToken;

export type AutocompleteInsertion = {
	value: string;
	caret: number;
};

function clampCaret(value: string, caret: number): number {
	return Math.max(0, Math.min(caret, value.length));
}

function isWhitespace(value: string): boolean {
	return /\s/u.test(value);
}

function isMentionBoundary(value: string | undefined): boolean {
	return value === undefined || isWhitespace(value) || '([{\'"`='.includes(value);
}

function isProjectPathCharacter(value: string): boolean {
	return /[\p{L}\p{N}_./~:+\\-]/u.test(value);
}

/**
 * Returns the slash token only when it is the first non-whitespace token and
 * the caret has not moved into its arguments.
 */
export function getLeadingSlashCommandToken(
	value: string,
	caret: number
): SlashCommandToken | undefined {
	const position = clampCaret(value, caret);
	let start = 0;
	while (start < value.length && isWhitespace(value[start])) {
		start += 1;
	}
	if (value[start] !== '/') {
		return undefined;
	}

	let end = start;
	while (end < value.length && !isWhitespace(value[end])) {
		end += 1;
	}
	if (position <= start || position > end) {
		return undefined;
	}

	return { kind: 'command', start, end, query: value.slice(start + 1, position) };
}

/**
 * Finds an @ token at a message-token boundary. This deliberately excludes
 * email addresses and @ characters embedded in another token.
 */
export function getFileAutocompleteToken(
	value: string,
	caret: number
): FileAutocompleteToken | undefined {
	const position = clampCaret(value, caret);
	let trigger = position - 1;
	while (trigger >= 0 && isProjectPathCharacter(value[trigger])) {
		trigger -= 1;
	}
	if (value[trigger] !== '@' || !isMentionBoundary(value[trigger - 1])) {
		return undefined;
	}

	let end = trigger + 1;
	while (end < value.length && isProjectPathCharacter(value[end])) {
		end += 1;
	}

	return { kind: 'file', start: trigger, end, query: value.slice(trigger + 1, position) };
}

export function getChatAutocompleteToken(
	value: string,
	caret: number
): ChatAutocompleteToken | undefined {
	return getLeadingSlashCommandToken(value, caret) ?? getFileAutocompleteToken(value, caret);
}

function commandScore(command: SlashCommandSuggestion, query: string): number | undefined {
	const name = command.name.toLocaleLowerCase();
	const description = command.description?.toLocaleLowerCase() ?? '';
	if (!query) {
		return 0;
	}
	if (name === query) {
		return 0;
	}
	if (name.startsWith(query)) {
		return 1;
	}
	if (name.split(/[-_/.]/u).some((part) => part.startsWith(query))) {
		return 2;
	}
	if (name.includes(query)) {
		return 3;
	}
	if (description.includes(query)) {
		return 4;
	}
	return undefined;
}

/** Filters commands and gives exact and prefix matches precedence over descriptions. */
export function rankSlashCommands<T extends SlashCommandSuggestion>(
	commands: T[],
	query: string
): T[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return commands
		.map((command, index) => ({ command, index, score: commandScore(command, normalizedQuery) }))
		.filter(
			(entry): entry is { command: T; index: number; score: number } => entry.score !== undefined
		)
		.sort((left, right) => left.score - right.score || left.index - right.index)
		.map((entry) => entry.command);
}

function replaceToken(
	value: string,
	token: ChatAutocompleteToken,
	replacement: string
): AutocompleteInsertion {
	const needsTrailingSpace = token.end === value.length;
	const inserted = `${replacement}${needsTrailingSpace ? ' ' : ''}`;
	return {
		value: `${value.slice(0, token.start)}${inserted}${value.slice(token.end)}`,
		caret: token.start + inserted.length
	};
}

export function insertSlashCommand(
	value: string,
	token: SlashCommandToken,
	name: string
): AutocompleteInsertion {
	return replaceToken(value, token, `/${name}`);
}

/** Inserts a literal @-prefixed relative path, preserving surrounding message text. */
export function insertProjectFile(
	value: string,
	token: FileAutocompleteToken,
	path: string
): AutocompleteInsertion {
	return replaceToken(value, token, `@${path}`);
}
