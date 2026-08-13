import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeCsvParser } from '../scripts/extract-ucdp.mjs';

/**
 * Planted cases for the UCDP CSV reader (rules 27 and 32).
 *
 * This parser has had two defects and neither was found by a test, because
 * nothing could call it — it was module-private in a script whose only entry
 * point downloads a 39 MB archive. Both were found by cross-checking the record
 * count against Python's `csv`:
 *
 *   1. A line-based reader dropped 102,409 of 487,358 rows (21%) on fields
 *      containing embedded newlines.
 *   2. A `chunk[i + 1]` lookahead read `undefined` at a chunk boundary, so an
 *      escaped `""` split across a read boundary was misread as a closing quote.
 *      That cost 14 records out of 417,968 — 0.003%, which rounds to
 *      "100.00% kept" in the report.
 *
 * The second is the one that matters here: it is trivially reproducible by
 * feeding the parser two chunks, and invisible to any amount of eyeballing
 * totals. A parser whose correctness is asserted by its own accounting needs
 * cases from outside that accounting.
 */
function parse(chunks: string[]): string[][] {
  const records: string[][] = [];
  const parser = makeCsvParser((record: string[]) => records.push([...record]));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return records;
}

describe('UCDP CSV reader', () => {
  it('reads plain rows', () => {
    assert.deepEqual(parse(['a,b,c\n1,2,3\n']), [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a newline inside a quoted field instead of splitting the record', () => {
    // Defect 1: this is the 21% loss. A line-based reader sees three lines here.
    assert.deepEqual(parse(['id,text\n1,"line one\nline two"\n']), [
      ['id', 'text'],
      ['1', 'line one\nline two'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    assert.deepEqual(parse(['1,"he said ""stop"" loudly"\n']), [['1', 'he said "stop" loudly']]);
  });

  it('survives an escaped quote SPLIT ACROSS A CHUNK BOUNDARY', () => {
    // Defect 2, exactly. The lookahead used to read undefined at the seam and
    // treat the first quote as closing the field, after which every comma in the
    // rest of the record became a separator.
    assert.deepEqual(parse(['1,"he said ""', 'stop"" loudly",next\n']), [
      ['1', 'he said "stop" loudly', 'next'],
    ]);
  });

  it('survives a quoted field ending exactly at a chunk boundary', () => {
    assert.deepEqual(parse(['1,"done"', ',after\n']), [['1', 'done', 'after']]);
  });

  it('survives a record split across many single-character chunks', () => {
    // The strongest form of the boundary case: every position is a seam.
    const source = '1,"a,b""c"\n2,plain\n';
    assert.deepEqual(parse([...source]), [
      ['1', 'a,b"c'],
      ['2', 'plain'],
    ]);
  });

  it('treats CRLF as a terminator without leaving a carriage return in the data', () => {
    assert.deepEqual(parse(['a,b\r\n1,2\r\n']), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('emits a final record when the file does not end in a newline', () => {
    assert.deepEqual(parse(['a,b\n1,2']), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does NOT invent a trailing record when the file ends in a newline', () => {
    // A phantom row of empty fields would inflate the "read" count and make the
    // accounting balance against a total that is wrong.
    assert.deepEqual(parse(['a,b\n']), [['a', 'b']]);
  });

  it('keeps empty fields rather than dropping them', () => {
    assert.deepEqual(parse([',,\n']), [['', '', '']]);
  });

  it('treats a quote after content as literal, not as an opening quote', () => {
    // The parser only opens a quoted field when the field is still empty, which
    // is what RFC 4180 describes and what the GED data relies on.
    assert.deepEqual(parse(['ab"c,d\n']), [['ab"c', 'd']]);
  });
});
