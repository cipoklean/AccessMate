import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildErrorCard } from '../../lib/errorCard.js';

describe('errorCard.js', () => {
  it('builds card with title only', () => {
    const card = buildErrorCard({ title: 'Oops' });
    assert.equal(card.text, '⚠️ Oops');
    assert.equal(card.blocks.length, 1);
    assert.equal(card.blocks[0].text.text, '⚠️ Oops');
  });

  it('builds card with title and body', () => {
    const card = buildErrorCard({ title: 'Error', body: 'Something broke' });
    assert.ok(card.text.includes('Error'));
    assert.ok(card.text.includes('Something broke'));
    assert.equal(card.blocks.length, 2);
  });

  it('builds card with title, body, and hint', () => {
    const card = buildErrorCard({ title: 'Fail', body: 'Bad', hint: 'Try again' });
    assert.ok(card.text.includes('Fail'));
    assert.ok(card.text.includes('Bad'));
    assert.ok(card.text.includes('Try again'));
    assert.equal(card.blocks.length, 3);
  });

  it('uses defaults for empty options', () => {
    const card = buildErrorCard({});
    assert.ok(card.text.startsWith('⚠️ Something went wrong'));
    assert.ok(card.blocks.length >= 1);
  });

  it('handles no options at all', () => {
    const card = buildErrorCard();
    assert.ok(card.text.startsWith('⚠️ Something went wrong'));
  });

  it('blocks have correct Block Kit types', () => {
    const card = buildErrorCard({ title: 'T', body: 'B', hint: 'H' });
    assert.equal(card.blocks[0].type, 'header');
    assert.equal(card.blocks[1].type, 'section');
    assert.equal(card.blocks[2].type, 'context');
  });

  it('hint block includes 💡 prefix', () => {
    const card = buildErrorCard({ hint: 'Do this' });
    const hintBlock = card.blocks.find((b) => b.type === 'context');
    assert.ok(hintBlock.elements[0].text.includes('💡 Do this'));
  });
});
