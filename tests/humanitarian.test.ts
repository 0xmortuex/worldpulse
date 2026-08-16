import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HUMANITARIAN_GAP,
  HUMANITARIAN_SOURCES,
  blockedCount,
  oursToFix,
} from '../src/dossier/humanitarian';

/**
 * Phase C.3 — the humanitarian tab, before its data exists.
 *
 * All four sources are blocked and each is blocked DIFFERENTLY. The panel's
 * whole job right now is to keep those four facts apart, because merging them
 * into "no humanitarian data" would hide that three have named remedies and one
 * is a mistake of ours.
 */

describe('four blockers, four different facts', () => {
  it('every source records what it would provide, what it returned, and a remedy', () => {
    assert.ok(HUMANITARIAN_SOURCES.length > 0, 'no sources declared — the panel proves nothing');
    for (const source of HUMANITARIAN_SOURCES) {
      assert.ok(source.provides.trim().length > 0, `${source.id} does not say what it would contribute`);
      assert.match(source.observed, /HTTP \d{3}/, `${source.id} does not quote what was observed`);
      assert.ok(source.remedy.trim().length > 20, `${source.id} has no actionable remedy`);
    }
  });

  it('the blockers are distinct kinds, not one label', () => {
    /**
     * A decommissioned endpoint, a missing identifier, a bot block, a missing
     * credential and a wrong URL are five different situations. Collapsing them
     * would make the panel useless for the one thing it is currently for:
     * telling a reader which of them anyone can do something about.
     */
    const kinds = new Set(HUMANITARIAN_SOURCES.map((source) => source.blocker));
    assert.ok(kinds.size >= 3, `only ${kinds.size} distinct blocker kinds`);
  });

  it('names the one that is OUR mistake rather than their access control', () => {
    /**
     * IOM DTM returns 404 because the URL was inferred rather than read from
     * documentation. That is a fact about our guess, and hiding it among four
     * access blockers would let it look like someone else's gate.
     */
    assert.equal(oursToFix(), 1);
    const dtm = HUMANITARIAN_SOURCES.find((source) => source.id === 'iom-dtm');
    assert.match(dtm?.remedy ?? '', /THIS ONE IS OURS/);
    assert.match(dtm?.remedy ?? '', /inferred rather than read/);
  });

  it('the identifier is not called a secret', () => {
    // ReliefWeb's appname travels in the clear and names the caller. Calling it
    // a credential would put it in the wrong mental category — and the wrong
    // file.
    const reliefweb = HUMANITARIAN_SOURCES.find((source) => source.id === 'reliefweb');
    assert.match(reliefweb?.remedy ?? '', /identifier rather than a secret/);
  });

  it('the HAPI remedy is the one the response itself asked for', () => {
    const hapi = HUMANITARIAN_SOURCES.find((source) => source.id === 'hapi');
    assert.match(hapi?.remedy ?? '', /hdx@un\.org/);
    assert.match(hapi?.observed ?? '', /bot activity/);
  });
});

describe('the gap is stated as ours', () => {
  it('never says the country has no humanitarian data', () => {
    assert.doesNotMatch(HUMANITARIAN_GAP, /no humanitarian data for this country/i);
    assert.match(HUMANITARIAN_GAP, /gap in this app's access/i);
    assert.match(HUMANITARIAN_GAP, /not a finding about this country/i);
  });

  it('says every source ANSWERED — none answered with data', () => {
    /**
     * The distinction rule 3 exists for. These sources are reachable; they
     * refused. "Unreachable" would be a different claim and would point at a
     * different fix.
     */
    assert.match(HUMANITARIAN_GAP, /answered/);
    assert.equal(blockedCount(), HUMANITARIAN_SOURCES.length);
  });
});
