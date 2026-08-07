<script lang="ts">
	import type { ChatItem } from '$lib/contracts';
	import MessageRow from './MessageRow.svelte';

	type TimestampView = {
		datetime: string;
		text: string;
		title: string;
	};

	type Props = {
		item: ChatItem;
		modelName?: string;
		thinkingLevel?: string;
		timestamp?: TimestampView;
		onCopyMessage: (text: string) => Promise<boolean>;
		includeAttachments?: boolean;
	};

	let {
		item,
		modelName,
		thinkingLevel,
		timestamp,
		onCopyMessage,
		includeAttachments = true
	}: Props = $props();
</script>

<MessageRow {item} {modelName} {thinkingLevel} {timestamp} {onCopyMessage}>
	{#snippet content()}
		<article class="test-message-content">Message content</article>
	{/snippet}
	{#snippet attachments()}
		{#if includeAttachments}
			<ul class="test-attachments" aria-label="test attachments">
				<li>Attachment content</li>
			</ul>
		{/if}
	{/snippet}
</MessageRow>
