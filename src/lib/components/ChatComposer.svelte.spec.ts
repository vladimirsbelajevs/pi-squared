import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ChatComposer from './ChatComposer.svelte';

const models = [
	{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: true },
	{ provider: 'example', id: 'plain-test', name: 'Plain Test', reasoning: false }
];

function props(overrides: Record<string, unknown> = {}) {
	return {
		models,
		modelKey: 'openai::gpt-test',
		thinkingLevel: 'medium' as const,
		onSend: vi.fn().mockResolvedValue(true),
		onModelChange: vi.fn(),
		onThinkingChange: vi.fn(),
		...overrides
	};
}

describe('ChatComposer', () => {
	it('renders an empty composer with inline model and reasoning controls', async () => {
		const screen = render(ChatComposer, props());

		await expect.element(screen.getByRole('textbox', { name: 'Message Pi' })).toHaveValue('');
		await expect.element(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
		await expect
			.element(screen.getByRole('combobox', { name: 'Model' }))
			.toHaveValue('openai::gpt-test');
		await expect.element(screen.getByRole('combobox', { name: 'Reasoning' })).toHaveValue('medium');
	});

	it('trims and sends with Enter while Shift Enter remains a newline', async () => {
		const onSend = vi.fn().mockResolvedValue(true);
		const screen = render(ChatComposer, props({ onSend }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('  Inspect this route  ');
		await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
		expect(onSend).not.toHaveBeenCalled();

		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith('Inspect this route'));
	});

	it('restores a rejected message', async () => {
		const screen = render(ChatComposer, props({ onSend: vi.fn().mockResolvedValue(false) }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('Keep this draft');
		await screen.getByRole('button', { name: 'Send message' }).click();

		await expect.element(textbox).toHaveValue('Keep this draft');
		await expect.element(screen.getByRole('alert')).toBeVisible();
	});

	it('reports draft changes from typing and sending', async () => {
		const onDraftChange = vi.fn();
		const screen = render(ChatComposer, props({ onDraftChange }));
		const textbox = screen.getByRole('textbox', { name: 'Message Pi' });

		await textbox.fill('Persist this draft');
		expect(onDraftChange).toHaveBeenLastCalledWith('Persist this draft');
		await screen.getByRole('button', { name: 'Send message' }).click();
		expect(onDraftChange).toHaveBeenLastCalledWith('');
	});

	it('shows queue and stop controls while streaming', async () => {
		const onStop = vi.fn();
		const onQueueModeChange = vi.fn();
		const screen = render(
			ChatComposer,
			props({ isStreaming: true, onStop, onQueueModeChange, queueMode: 'followUp' })
		);

		await expect.element(screen.getByRole('button', { name: 'Stop response' })).toBeVisible();
		await expect.element(screen.getByRole('combobox', { name: 'Queue' })).toHaveValue('followUp');
		await screen.getByRole('button', { name: 'Stop response' }).click();
		expect(onStop).toHaveBeenCalledOnce();
	});
});
