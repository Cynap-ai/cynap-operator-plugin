// Unit tests for the zero-dep content codec. It must produce exactly the {encoding, content}
// shape the server's workspace tools read and write.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeContent, decodeContent, NonCanonicalContentError } from '../lib/content-codec.mjs';

test('encodeContent picks utf8 for lossless canonical text', () => {
  const encoded = encodeContent(Buffer.from('hello world', 'utf8'));
  assert.deepEqual(encoded, { encoding: 'utf8', content: 'hello world' });
});

test('encodeContent picks base64 for bytes containing a NUL', () => {
  const bytes = Buffer.from([104, 105, 0, 106]);
  const encoded = encodeContent(bytes);
  assert.equal(encoded.encoding, 'base64');
  assert.equal(Buffer.from(encoded.content, 'base64').equals(bytes), true);
});

test('encodeContent picks base64 for invalid UTF-8', () => {
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  const encoded = encodeContent(bytes);
  assert.equal(encoded.encoding, 'base64');
});

test('decodeContent is the exact inverse of encodeContent (round-trip)', () => {
  for (const bytes of [Buffer.from('hello'), Buffer.from([0, 1, 2, 255]), Buffer.alloc(0)]) {
    const encoded = encodeContent(bytes);
    assert.equal(decodeContent(encoded).equals(bytes), true);
  }
});

test('decodeContent refuses non-canonical base64 (wrong padding)', () => {
  assert.throws(() => decodeContent({ encoding: 'base64', content: 'aGVsbG8' }), NonCanonicalContentError);
});

test('decodeContent refuses base64 with invalid alphabet characters', () => {
  assert.throws(() => decodeContent({ encoding: 'base64', content: '!!!!' }), NonCanonicalContentError);
});

test('decodeContent accepts canonical base64', () => {
  const encoded = Buffer.from('hi').toString('base64');
  assert.equal(decodeContent({ encoding: 'base64', content: encoded }).toString('utf8'), 'hi');
});
