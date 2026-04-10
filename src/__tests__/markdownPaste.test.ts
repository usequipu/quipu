import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';

// These tests verify that the markdown parser correctly converts markdown
// syntax into semantic HTML — which is what handlePaste now routes all text
// through. Semantic HTML nodes serialized back to markdown do NOT get
// backslash-escaped; only raw text nodes do.
//
// Integration note: the full paste → node-creation → serialize round-trip
// can only be verified with a real browser + TipTap editor. These unit tests
// confirm the parse side of the fix is sound.

const md = new MarkdownIt({ html: true, linkify: true });

describe('markdown-it parse: no backslash escapes in output HTML', () => {
    it('parses **bold** into <strong> without escaping asterisks', () => {
        const html = md.render('**bold text**');
        expect(html).toContain('<strong>bold text</strong>');
        expect(html).not.toContain('\\*');
    });

    it('parses *italic* into <em> without escaping asterisks', () => {
        const html = md.render('*italic text*');
        expect(html).toContain('<em>italic text</em>');
        expect(html).not.toContain('\\*');
    });

    it('parses [link](url) into <a> without escaping brackets', () => {
        const html = md.render('[link text](https://example.com)');
        expect(html).toContain('<a href="https://example.com">link text</a>');
        expect(html).not.toContain('\\[');
        expect(html).not.toContain('\\]');
    });

    it('parses # heading into <h1> without escaping the hash', () => {
        const html = md.render('# My Heading');
        expect(html).toContain('<h1>My Heading</h1>');
        expect(html).not.toContain('\\#');
    });

    it('parses - list item into <li> without escaping the dash', () => {
        const html = md.render('- list item');
        expect(html).toContain('<li>list item</li>');
        expect(html).not.toContain('\\-');
    });

    it('parses `code` into <code> without escaping backticks', () => {
        const html = md.render('Use `console.log()`');
        expect(html).toContain('<code>console.log()</code>');
        expect(html).not.toContain('\\`');
    });

    it('handles plain prose with no markdown syntax unchanged', () => {
        const html = md.render('Hello world, no special chars here.');
        expect(html).toContain('Hello world, no special chars here.');
        expect(html).not.toMatch(/\\/);
    });

    it('does not crash on empty string', () => {
        expect(() => md.render('')).not.toThrow();
        expect(md.render('')).toBe('');
    });

    it('handles mixed inline markdown in one paste', () => {
        const html = md.render('**bold** and *italic* and [link](url)');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<em>italic</em>');
        expect(html).toContain('<a href="url">link</a>');
        expect(html).not.toContain('\\*');
        expect(html).not.toContain('\\[');
    });

    it('parses a fenced code block without escaping backticks', () => {
        const html = md.render('```js\nconsole.log("hi");\n```');
        expect(html).toContain('<code');
        expect(html).toContain('console.log');
        expect(html).not.toContain('\\`');
    });

    it('parses _italic_ (underscore) into <em> without escaping underscores', () => {
        const html = md.render('_italic_');
        expect(html).toContain('<em>italic</em>');
        expect(html).not.toContain('\\_');
    });

    it('parses ~~strikethrough~~ (tilde) without escaping tildes', () => {
        const md2 = new MarkdownIt({ html: true }).enable('strikethrough');
        const html = md2.render('~~deleted~~');
        expect(html).toContain('<s>deleted</s>');
        expect(html).not.toContain('\\~');
    });
});
