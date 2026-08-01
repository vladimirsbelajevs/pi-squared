import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import MarkdownIt from 'markdown-it';

const ENCODED_CONTROL_CHARACTER = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const ENCODED_SCHEME_SEPARATOR = /^[a-z][a-z0-9+.-]*%(?:25)*3a/i;
const CODE_COPY_BUTTON = `<button class="code-copy-action" type="button" data-code-copy aria-label="Copy code" title="Copy code"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="6" width="8" height="9" rx="1.25" stroke="currentColor" stroke-width="1.5"/><path d="M5 12V5.25C5 4.56 5.56 4 6.25 4H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`;

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdownLanguage);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (
			codePoint === undefined ||
			codePoint <= 0x1f ||
			(codePoint >= 0x7f && codePoint <= 0x9f) ||
			codePoint === 0xfffd
		) {
			return true;
		}
	}

	return false;
}

function hasRejectedLinkSyntax(url: string): boolean {
	return (
		containsControlCharacter(url) ||
		ENCODED_CONTROL_CHARACTER.test(url) ||
		ENCODED_SCHEME_SEPARATOR.test(url)
	);
}

function isAllowedLink(url: string): boolean {
	if (hasRejectedLinkSyntax(url)) {
		return false;
	}

	return (
		/^https?:/i.test(url) ||
		/^mailto:/i.test(url) ||
		url.startsWith('#') ||
		(url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\'))
	);
}

const markdown = new MarkdownIt({
	html: false,
	linkify: false,
	breaks: false,
	highlight(code, language) {
		const normalizedLanguage = language.trim().toLowerCase();
		if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) {
			return '';
		}

		return hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value;
	}
});
const defaultFence = markdown.renderer.rules.fence;

if (!defaultFence) {
	throw new Error('Markdown-it fence renderer is unavailable.');
}

markdown.renderer.rules.fence = (...args) =>
	`<div class="markdown-code-block" data-code-block>${CODE_COPY_BUTTON}${defaultFence(...args)}</div>\n`;
const defaultNormalizeLink = markdown.normalizeLink.bind(markdown);
const defaultValidateLink = markdown.validateLink.bind(markdown);

markdown.normalizeLink = (url) =>
	hasRejectedLinkSyntax(url) ? 'invalid:' : defaultNormalizeLink(url);
markdown.validateLink = (url) => defaultValidateLink(url) && isAllowedLink(url);
markdown.renderer.rules.image = () => '';

export function renderAssistantMarkdown(text: string): string {
	return markdown.render(text);
}
