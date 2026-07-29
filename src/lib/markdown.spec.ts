import { describe, expect, it } from 'vitest';
import { renderAssistantMarkdown } from './markdown';

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
		expect(html).toContain('<pre><code class="language-ts">const answer = 42;\n</code></pre>');
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
