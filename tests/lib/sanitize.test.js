import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeForSlack, stripSlackMarkup } from '../../lib/sanitize.js';

describe('sanitize.js', () => {
  describe('stripSlackMarkup', () => {
    it('strips user mentions <@U123>', () => {
      assert.equal(stripSlackMarkup('Hello <@U1234567>'), 'Hello @someone');
    });

    it('strips user mentions with names <@U123|Alice>', () => {
      assert.equal(stripSlackMarkup('Hey <@U1234567|Alice>!'), 'Hey @someone!');
    });

    it('strips usergroup references <!subteam^S123|Group>', () => {
      assert.equal(stripSlackMarkup('Ping <!subteam^S12345|Engineering>'), 'Ping @team');
    });

    it('strips <!channel> special refs', () => {
      assert.equal(stripSlackMarkup('Attention <!channel>'), 'Attention @channel');
    });

    it('strips <!here> special refs', () => {
      assert.equal(stripSlackMarkup('Hey <!here>!'), 'Hey @channel!');
    });

    it('strips <!everyone> special refs', () => {
      assert.equal(stripSlackMarkup('<!everyone> listen up'), '@channel listen up');
    });

    it('converts link markup to plain text + url', () => {
      assert.equal(stripSlackMarkup('Check <https://example.com|the docs>'), 'Check the docs (https://example.com)');
    });

    it('removes date refs', () => {
      assert.equal(stripSlackMarkup('Due <!date^1234567^{date_short}|Tomorrow>'), 'Due ');
    });

    it('removes unknown special markup', () => {
      assert.equal(stripSlackMarkup('Weird <!something_unknown>'), 'Weird ');
    });

    it('returns empty string for null/undefined', () => {
      assert.equal(stripSlackMarkup(null), null);
      assert.equal(stripSlackMarkup(undefined), undefined);
    });

    it('leaves plain text untouched', () => {
      assert.equal(stripSlackMarkup('Just normal text'), 'Just normal text');
    });

    it('handles mixed markup', () => {
      const input = '<@U111> check <https://go.com|this> and ping <!here>';
      assert.equal(stripSlackMarkup(input), '@someone check this (https://go.com) and ping @channel');
    });
  });

  describe('sanitizeForSlack', () => {
    it('escapes angle brackets', () => {
      assert.equal(sanitizeForSlack('<script>alert(1)</script>'), '‹script›alert(1)‹/script›');
    });

    it('handles empty string', () => {
      assert.equal(sanitizeForSlack(''), '');
    });

    it('handles null/undefined gracefully', () => {
      assert.equal(sanitizeForSlack(null), '');
      assert.equal(sanitizeForSlack(undefined), '');
    });

    it('leaves normal text unchanged', () => {
      assert.equal(sanitizeForSlack('Hello world'), 'Hello world');
    });

    it('escapes only angle brackets, not other chars', () => {
      assert.equal(sanitizeForSlack('a & b "c" \'d\''), 'a & b "c" \'d\'');
    });
  });
});
