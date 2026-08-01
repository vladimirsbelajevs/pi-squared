import { describe, expect, it } from 'vitest';
import {
	getChatAutocompleteToken,
	getFileAutocompleteToken,
	getLeadingSlashCommandToken,
	insertProjectFile,
	insertSlashCommand,
	rankSlashCommands
} from './chat-autocomplete';

describe('chat autocomplete helpers', () => {
	it('only activates slash completion for the leading token before arguments', () => {
		expect(getLeadingSlashCommandToken('  /review src', 9)).toEqual({
			kind: 'command',
			start: 2,
			end: 9,
			query: 'review'
		});
		expect(getLeadingSlashCommandToken('  /review src', 10)).toBeUndefined();
		expect(getLeadingSlashCommandToken('Read /review', 12)).toBeUndefined();
	});

	it('finds @ tokens at message boundaries anywhere in the message', () => {
		expect(getFileAutocompleteToken('Compare @src/lib/chat.ts with this', 24)).toEqual({
			kind: 'file',
			start: 8,
			end: 24,
			query: 'src/lib/chat.ts'
		});
		expect(getFileAutocompleteToken('email@company.test', 18)).toBeUndefined();
		expect(getFileAutocompleteToken('Open (@src/main.ts)', 18)).toEqual({
			kind: 'file',
			start: 6,
			end: 18,
			query: 'src/main.ts'
		});
		expect(getChatAutocompleteToken('then @src', 9)?.kind).toBe('file');
	});

	it('ranks exact and prefix command matches ahead of description matches', () => {
		const commands = [
			{ name: 'deploy', source: 'skill' as const, description: 'Publish a release' },
			{ name: 'review', source: 'prompt' as const, description: 'Review the deployment' },
			{ name: 'redeploy', source: 'extension' as const, description: 'Deploy again' }
		];

		expect(rankSlashCommands(commands, 'deploy').map((command) => command.name)).toEqual([
			'deploy',
			'redeploy',
			'review'
		]);
	});

	it('replaces only the active token and keeps text after the caret', () => {
		const commandToken = getLeadingSlashCommandToken('/rev follow-up', 4);
		const fileToken = getFileAutocompleteToken('Read @sr then', 8);
		if (!commandToken || !fileToken) {
			throw new Error('Expected completion tokens');
		}

		expect(insertSlashCommand('/rev follow-up', commandToken, 'review')).toEqual({
			value: '/review follow-up',
			caret: 7
		});
		expect(insertProjectFile('Read @sr then', fileToken, 'src/main.ts')).toEqual({
			value: 'Read @src/main.ts then',
			caret: 17
		});
	});
});
