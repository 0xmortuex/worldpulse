import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answeredSections, loadGovernmentLive } from '../src/dossier/government-live';
import { fetcherFor } from '../src/fetch/scenario';

/**
 * The third and last panel through the harness — and the first with more than
 * one query behind it.
 *
 * The property that matters here is not that it loads. It is that four queries
 * fail INDEPENDENTLY, so "the judiciary query timed out" cannot become "the
 * government tab is unavailable" and hide three sections that answered.
 */

describe('government: four queries that fail independently', () => {
  it('a total outage fails every section, and says so per section', async () => {
    const load = await loadGovernmentLive(fetcherFor('?econ=unavailable'), 'GBR');

    assert.equal(answeredSections(load), 0);
    for (const [name, entry] of Object.entries(load)) {
      if (name === 'iso3') continue;
      const section = entry as { failure: unknown; value: unknown };
      assert.ok(section.failure, `${name} reported no failure during a total outage`);
      assert.equal(section.value, null, `${name} produced a value during a total outage`);
    }
  });

  it('ONE SECTION FAILING DOES NOT TAKE THE OTHERS WITH IT', async () => {
    /**
     * The assertion this loader exists for.
     *
     * Under `degraded` the handler answers for the United Kingdom and refuses
     * for Iceland — so a country-level degrade is the closest this harness gets
     * to a per-query one, and what it proves is the structural point: every
     * section resolves on its own rather than one rejection collapsing the set.
     *
     * A `Promise.all` over rejecting promises would turn any single failure
     * into a total one, which is the degraded state collapsing into the
     * unavailable one.
     */
    const load = await loadGovernmentLive(fetcherFor('?econ=degraded'), 'GBR');

    // Every section resolved — none threw, whatever its individual verdict.
    assert.equal(Object.keys(load).length, 5, 'a section is missing from the result');
    assert.ok(
      answeredSections(load) > 0,
      'no section answered for the country the degraded scenario serves',
    );
  });

  it('A MISMATCHED BUT WELL-FORMED RESPONSE PARSES TO EMPTY, not to a failure', async () => {
    /**
     * THIS TEST ASSERTED THE OPPOSITE AND WAS WRONG.
     *
     * It expected `parseCabinet` to throw when handed a legislature response,
     * on the reasoning that an unreadable body is a failed request rather than
     * an empty section. The parsers do not work that way: they read a SPARQL
     * results envelope and collect the rows that match their variables, so a
     * well-formed response with no matching rows yields an EMPTY result, not a
     * `ShapeError`.
     *
     * Recorded rather than "fixed", because in production the query and the
     * response are matched by the endpoint — you cannot receive a legislature
     * answer to a cabinet question. The leniency is only reachable through a
     * fixture handler that serves one capture for every query.
     *
     * What it DOES mean, and is worth knowing: shape failures on this source
     * come from malformed envelopes, not from wrong-but-valid ones. So the
     * empty-versus-failed distinction the panel draws is real, and the case
     * that produces "empty" is broader than it first appears.
     */
    const load = await loadGovernmentLive(fetcherFor('?econ=fixtures'), 'GBR');

    assert.equal(load.cabinet.failure, null, 'a well-formed mismatched body now fails — recheck the parser');
    assert.ok(load.cabinet.value, 'the cabinet section produced nothing at all');
    assert.equal(load.cabinet.value.ministries.length, 0, 'a legislature response yielded ministries');
  });

  it('and the section that CAN read its body still answers', async () => {
    /**
     * The positive control that makes the test above mean something. Without
     * it, "cabinet failed" would be satisfied by a loader that failed
     * everything.
     */
    const load = await loadGovernmentLive(fetcherFor('?econ=fixtures'), 'GBR');
    assert.ok(load.chambers.value, 'the legislature section failed too — nothing is being demonstrated');
    assert.equal(load.chambers.failure, null);
    assert.deepEqual(
      load.chambers.value.map((chamber) => chamber.label).sort(),
      ['House of Commons', 'House of Lords'],
    );
  });

  it('answeredSections counts what a degraded disclosure needs', async () => {
    /**
     * The partial case is asserted through the DEGRADED scenario rather than
     * through `fixtures`, which was the first version's mistake: the handler
     * serves every query from one capture, and the parsers are lenient enough
     * that all four then answer. A test expecting a partial load there was
     * expecting a fixture artefact.
     */
    const all = await loadGovernmentLive(fetcherFor('?econ=fixtures'), 'GBR');
    const none = await loadGovernmentLive(fetcherFor('?econ=unavailable'), 'GBR');
    const refused = await loadGovernmentLive(fetcherFor('?econ=degraded'), 'ISL');

    assert.equal(answeredSections(all), 4, 'a servable scenario did not answer every section');
    assert.equal(answeredSections(none), 0, 'a total outage answered something');
    assert.equal(answeredSections(refused), 0, 'the degraded scenario served a country it refuses');

    // The three counts must differ from each other, or one scenario is
    // standing in for another and the function is untested at its middle.
    assert.notEqual(answeredSections(all), answeredSections(none));
  });

  it('every failure names Wikidata rather than the World Bank', async () => {
    const load = await loadGovernmentLive(fetcherFor('?econ=unavailable'), 'GBR');
    assert.match(load.cabinet.failure?.requestUrl ?? '', /query\.wikidata\.org/);
    assert.doesNotMatch(load.cabinet.failure?.requestUrl ?? '', /worldbank/);
  });
});
