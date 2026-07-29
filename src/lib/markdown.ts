import MarkdownIt from 'markdown-it';

const ENCODED_CONTROL_CHARACTER = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const ENCODED_SCHEME_SEPARATOR = /^[a-z][a-z0-9+.-]*%(?:25)*3a/i;

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
	breaks: false
});
const defaultNormalizeLink = markdown.normalizeLink.bind(markdown);
const defaultValidateLink = markdown.validateLink.bind(markdown);

markdown.normalizeLink = (url) =>
	hasRejectedLinkSyntax(url) ? 'invalid:' : defaultNormalizeLink(url);
markdown.validateLink = (url) => defaultValidateLink(url) && isAllowedLink(url);
markdown.renderer.rules.image = () => '';

export function renderAssistantMarkdown(text: string): string {
	return markdown.render(text);
}
