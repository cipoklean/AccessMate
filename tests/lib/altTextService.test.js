import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALT_TEXT_PROMPT, buildAltTextCard, findMostRecentImage } from '../../lib/altTextService.js';

describe('altTextService.js', () => {
  describe('findMostRecentImage', () => {
    it('returns the first image file found', () => {
      const messages = [
        { files: [{ mimetype: 'text/plain', name: 'doc.pdf' }] },
        { files: [{ mimetype: 'image/png', name: 'screenshot.png' }] },
      ];
      const result = findMostRecentImage(messages);
      assert.equal(result.name, 'screenshot.png');
    });

    it('returns null when no files property', () => {
      assert.equal(findMostRecentImage([{ text: 'no files' }]), null);
    });

    it('returns null when no image files', () => {
      const messages = [{ files: [{ mimetype: 'application/pdf', name: 'doc.pdf' }] }];
      assert.equal(findMostRecentImage(messages), null);
    });

    it('returns null for empty message array', () => {
      assert.equal(findMostRecentImage([]), null);
    });

    it('returns first image in first matching message', () => {
      const messages = [
        {
          files: [
            { mimetype: 'image/jpeg', name: 'first.jpg' },
            { mimetype: 'image/png', name: 'second.png' },
          ],
        },
      ];
      const result = findMostRecentImage(messages);
      assert.equal(result.name, 'first.jpg');
    });

    it('skips messages without files', () => {
      const messages = [{ text: 'no files here' }, { files: [{ mimetype: 'image/gif', name: 'anim.gif' }] }];
      const result = findMostRecentImage(messages);
      assert.equal(result.name, 'anim.gif');
    });
  });

  describe('buildAltTextCard', () => {
    it('builds card with provided alt text and file name', () => {
      const card = buildAltTextCard('A cat sleeping on a sofa.', 'cat.jpg');
      assert.ok(card.text.includes('cat.jpg'));
      assert.ok(card.text.includes('A cat sleeping'));
      assert.equal(card.blocks.length, 4);
    });

    it('uses "image" as default name', () => {
      const card = buildAltTextCard('Some alt text');
      assert.ok(card.text.includes('image'));
    });

    it('header block has correct text', () => {
      const card = buildAltTextCard('Test alt');
      assert.equal(card.blocks[0].text.text, '🖼️ Alt text');
    });

    it('context block shows char count', () => {
      const card = buildAltTextCard('Hello world', 'test.png');
      // blocks[1] is a context block whose text lives in elements[0].text
      assert.ok(card.blocks[1].elements[0].text.includes('11 chars'));
    });

    it('alt text is in section block', () => {
      const card = buildAltTextCard('Unique description');
      assert.equal(card.blocks[2].text.text, 'Unique description');
    });

    it('last block has copy hint', () => {
      const card = buildAltTextCard('Test', 'f.png');
      assert.ok(card.blocks[3].elements[0].text.includes('💡'));
    });
  });

  describe('ALT_TEXT_PROMPT', () => {
    it('is a non-empty string', () => {
      assert.ok(typeof ALT_TEXT_PROMPT === 'string');
      assert.ok(ALT_TEXT_PROMPT.length > 100);
    });

    it('mentions alt text generation', () => {
      assert.ok(ALT_TEXT_PROMPT.includes('alt text'));
    });

    it('mentions screen readers', () => {
      assert.ok(ALT_TEXT_PROMPT.includes('screen reader'));
    });
  });
});
