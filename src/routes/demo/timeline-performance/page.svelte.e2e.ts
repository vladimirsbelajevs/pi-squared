import { expect, test } from '@playwright/test';

test('renders deterministic timeline performance fixture counts', async ({ page }) => {
	await page.goto('/demo/timeline-performance');

	const fixture = page.locator('[data-fixture="timeline-performance"]');
	await expect(fixture).toHaveAttribute('data-message-count', '200');
	await expect(fixture).toHaveAttribute('data-notice-count', '4');
	await expect(fixture).toHaveAttribute('data-tool-group-count', '5');
	await expect(fixture).toHaveAttribute('data-image-count', '6');
	await expect(fixture).toHaveAttribute('data-large-code-block-count', '5');

	await expect(page.locator('.message-entry')).toHaveCount(200);
	await expect(page.locator('.timeline-notice')).toHaveCount(4);
	await expect(page.locator('.tool-group')).toHaveCount(5);
	await expect(page.locator('.attachment-preview-thumbnail')).toHaveCount(6);
	await expect(page.locator('.message-markdown .markdown-code-block')).toHaveCount(5);
	await expect(page.locator('.tool-group[open]')).toHaveCount(0);
	await expect(page.locator('.message-meta-content time')).toHaveCount(200);
	await expect(page.locator('button[aria-label="Copy message"]')).toHaveCount(200);
});
