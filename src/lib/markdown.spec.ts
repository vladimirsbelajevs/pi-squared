import { describe, expect, it } from 'vitest';
import { renderAssistantMarkdown, renderStreamingMarkdown } from './markdown';

describe('renderAssistantMarkdown', () => {
	it('renders common assistant Markdown', () => {
		const html = renderAssistantMarkdown(
			'# Heading\n\nThis is *emphasized*.\n\n- First\n- Second\n\n[Docs](https://example.test/docs)\n\n```ts\nconst answer = 42;\n```'
		);

		expect(html).toContain('<h1>Heading</h1>');
		expect(html).toContain('<em>emphasized</em>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>First</li>');
		expect(html).toContain('<a href="https://example.test/docs">Docs</a>');
		expect(html).toContain('<div class="markdown-code-block" data-code-block>');
		expect(html).toContain('class="code-copy-action"');
		expect(html).toContain('data-code-copy');
		expect(html).toContain(
			'<pre><code class="language-ts"><span class="hljs-keyword">const</span>'
		);
	});

	it('adds copy controls only to fenced code blocks', () => {
		const html = renderAssistantMarkdown('Inline `code`.\n\n```ts\nconst answer = 42;\n```');

		expect(html).toContain('data-code-block');
		expect(html.match(/data-code-copy/g)).toHaveLength(1);
		expect(html).toContain('<p>Inline <code>code</code>.</p>');
	});

	it('highlights C# and Bash code blocks', () => {
		const html = renderAssistantMarkdown(
			'```csharp\npublic class Greeter {}\n```\n\n```bash\necho "$HOME"\n```'
		);

		expect(html).toContain('class="language-csharp"');
		expect(html).toContain('class="language-bash"');
		expect(html).toContain('class="hljs-keyword"');
		expect(html).toContain('class="hljs-built_in"');
	});

	it('escapes code when its language is unknown', () => {
		const html = renderAssistantMarkdown(
			'```not-a-language\n<script>alert("unsafe")</script>\n```'
		);

		expect(html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;');
		expect(html).not.toContain('hljs-');
	});

	it('escapes raw HTML instead of returning DOM elements', () => {
		const html = renderAssistantMarkdown('<script>alert("unsafe")</script>');

		expect(html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;');
		expect(html).not.toContain('<script>');
	});

	it('omits image elements', () => {
		const html = renderAssistantMarkdown('![Logo](https://example.test/logo.svg "Logo")');

		expect(html).not.toContain('<img');
		expect(html).not.toContain('https://example.test/logo.svg');
	});

	it('keeps only explicitly allowed link URLs', () => {
		const allowed = [
			['https', 'https://example.test/docs'],
			['http', 'http://example.test/docs'],
			['mailto', 'mailto:hello@example.test'],
			['fragment', '#details'],
			['root-relative', '/docs/markdown']
		] as const;
		const html = renderAssistantMarkdown(
			allowed.map(([label, url]) => `[${label}](${url})`).join('\n\n')
		);

		for (const [label, url] of allowed) {
			expect(html).toContain(`<a href="${url}">${label}</a>`);
		}

		expect(html).not.toContain('target=');
	});

	it('rejects unsafe, encoded, case-variant, and control-character URLs', () => {
		const unsafeUrls = [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'javascript%3Aalert(1)',
			'java%0Ascript%3Aalert(1)',
			'java\u0000script:alert(1)',
			'https://example.test/\u0000header',
			'https://example.test/%0Aheader',
			'data:text/html,unsafe',
			'file:///etc/passwd',
			'//example.test/path',
			'https%3A%2F%2Fevil.test/path'
		];

		for (const url of unsafeUrls) {
			expect(renderAssistantMarkdown(`[unsafe](${url})`)).not.toContain('<a ');
		}
	});
});

describe('renderStreamingMarkdown', () => {
	it('renders Markdown without highlighting or copy controls', () => {
		const html = renderStreamingMarkdown(
			'## Heading\n\nThis is **emphasized**.\n\n- First\n- Second\n\n[Docs](https://example.test/docs)\n\n```ts\nconst answer = 42;\n'
		);

		expect(html).toContain('<h2>Heading</h2>');
		expect(html).toContain('<strong>emphasized</strong>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>First</li>');
		expect(html).toContain('<a href="https://example.test/docs">Docs</a>');
		expect(html).toContain('<pre><code class="language-ts">const answer = 42;\n</code></pre>');
		expect(html).not.toContain('hljs-');
		expect(html).not.toContain('data-code-copy');
		expect(html).not.toContain('markdown-code-block');
	});

	it('retains the final renderer safety policy', () => {
		const unsafe = '<script>alert("unsafe")</script>\n\n![Logo](https://example.test/logo.svg)';
		const unsafeUrls = [
			'javascript:alert(1)',
			'javascript%3Aalert(1)',
			'//example.test/path',
			'data:text/html,unsafe'
		];

		const streamingHtml = renderStreamingMarkdown(unsafe);
		expect(streamingHtml).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;');
		expect(streamingHtml).not.toContain('<script>');
		expect(streamingHtml).not.toContain('<img');

		for (const url of unsafeUrls) {
			expect(renderStreamingMarkdown(`[unsafe](${url})`)).not.toContain('<a ');
		}

		expect(renderAssistantMarkdown(unsafe)).toBe(streamingHtml);
	});
});
