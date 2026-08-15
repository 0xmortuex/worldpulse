import type { Fact } from '../facts/types';
import { expectArray, expectObject, fetchProvenance, ShapeError, type FetchContext } from './adapter';

const SOURCE_ID = 'feodo-tracker';

const SERVICE = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';

/**
 * abuse.ch Feodo Tracker — IP addresses observed hosting botnet C2 servers.
 *
 * ## WHAT AN ENTRY IS A STATEMENT ABOUT
 *
 * A **host**. Not a person, not an organisation, and not a country.
 *
 * The `country` field is where the machine sits — very often a hosting provider
 * in a jurisdiction with cheap capacity, which is why DigitalOcean and OVH
 * dominate these lists. Rendering it as "attacks from country X" would assert
 * three things the data does not say: that the country is the origin, that
 * someone there operates it, and that intent can be attributed to either.
 *
 * A compromised server in Frankfurt run from anywhere is the normal case, not the
 * exception.
 *
 * ## An offline C2 is a historical record
 *
 * `status` is `online` or `offline` per entry, and an offline server is one that
 * has stopped answering — a record of what happened, not a current threat.
 * Counting the two together answers neither "what is live now" nor "what has
 * been seen", which is rule 22's aggregation across kinds in miniature.
 *
 * ## Licence
 *
 * NOT CC0, whatever the plan documents said. abuse.ch reserves all rights,
 * requires acknowledgement, and prohibits commercial use without a separate
 * licence — class `nc`, satisfiable only while this project stays
 * non-commercial. See `OPEN-QUESTIONS` 22.
 */

export function buildBlocklistUrl(): string {
  // No parameters: the endpoint serves one document. Exported anyway so the
  // fixture derives its URL from the app's own request (rule 26).
  return SERVICE;
}

export type C2Status = 'online' | 'offline';

export interface C2Server {
  ipAddress: string;
  port: number;
  status: C2Status;
  /** Malware family, e.g. `Emotet`, `QakBot`. */
  malware: string;
  /** ISO 3166-1 alpha-2 of the HOST, never of an operator. */
  country: string | null;
  /** Autonomous system number, or null when abuse.ch does not record one. */
  asNumber: number | null;
  asName: string | null;
  hostname: string | null;
  firstSeen: string;
  /** Null while a server is still online — it has not gone offline yet. */
  lastOnline: string | null;
}

/**
 * abuse.ch emits dates as `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`, space-separated
 * rather than ISO. Normalised here so nothing downstream parses two formats, and
 * a value in neither shape throws rather than becoming an Invalid Date that
 * renders as blank.
 */
function timestamp(raw: unknown, at: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ShapeError(SOURCE_ID, `${at} is ${JSON.stringify(raw)}, expected a date string`);
  }
  const text = raw.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(text);
  if (!match) throw new ShapeError(SOURCE_ID, `${at} is "${text}", expected YYYY-MM-DD[ HH:MM:SS]`);
  return `${match[1]}T${match[2] ?? '00:00:00'}Z`;
}

function optionalTimestamp(raw: unknown, at: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return timestamp(raw, at);
}

export function parse(payload: unknown): C2Server[] {
  const rows = expectArray(SOURCE_ID, payload, 'response');

  return rows.map((entry, index): C2Server => {
    const row = expectObject(SOURCE_ID, entry, `[${index}]`);
    const at = `[${index}]`;

    const status = row['status'];
    if (status !== 'online' && status !== 'offline') {
      throw new ShapeError(
        SOURCE_ID,
        `${at}.status is ${JSON.stringify(status)}, expected "online" or "offline". ` +
          'A third state would mean current and historical records can no longer be told apart',
      );
    }

    const ip = row['ip_address'];
    if (typeof ip !== 'string' || !/^[0-9a-f.:]+$/i.test(ip)) {
      throw new ShapeError(SOURCE_ID, `${at}.ip_address is ${JSON.stringify(ip)}`);
    }

    const port = row['port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ShapeError(SOURCE_ID, `${at}.port is ${JSON.stringify(port)}, expected 1–65535`);
    }

    const malware = row['malware'];
    if (typeof malware !== 'string' || malware.trim() === '') {
      throw new ShapeError(SOURCE_ID, `${at}.malware is ${JSON.stringify(malware)}`);
    }

    const country = row['country'];
    const asNumber = row['as_number'];

    return {
      ipAddress: ip,
      port,
      status,
      malware: malware.trim(),
      // Absent is absent. An unattributed host must not become a country.
      country: typeof country === 'string' && country.trim() !== '' ? country.trim() : null,
      asNumber: typeof asNumber === 'number' && Number.isInteger(asNumber) ? asNumber : null,
      asName: typeof row['as_name'] === 'string' && row['as_name'] !== '' ? String(row['as_name']) : null,
      hostname: typeof row['hostname'] === 'string' && row['hostname'] !== '' ? String(row['hostname']) : null,
      firstSeen: timestamp(row['first_seen'], `${at}.first_seen`),
      // Null while still online: it has not gone offline yet, which is not the
      // same as an unknown date.
      lastOnline: optionalTimestamp(row['last_online'], `${at}.last_online`),
    };
  });
}

/** Servers still answering. Never merged with offline records. */
export function online(servers: readonly C2Server[]): C2Server[] {
  return servers.filter((server) => server.status === 'online');
}

/**
 * How many C2 servers are CURRENTLY ONLINE and hosted in a country.
 *
 * ## Tier: OFFICIAL, and the note carries what it is not
 *
 * abuse.ch observed these hosts directly; the count is theirs, not ours. But
 * every reading a user might take from it beyond "servers sit here" is
 * unsupported, so the note says so rather than leaving the country column to
 * imply the rest.
 *
 * Offline entries are excluded by construction — `online` does the filtering, so
 * a caller cannot accidentally count a server that stopped answering in 2022 as
 * a present threat.
 */
export function onlineInCountryFact(
  servers: readonly C2Server[],
  countryCode: string,
  ctx: FetchContext,
): Fact<number> {
  const live = online(servers).filter((server) => server.country === countryCode);
  const families = [...new Set(live.map((server) => server.malware))].sort();

  return {
    value: live.length,
    asOf: ctx.fetchedAt.slice(0, 10),
    tier: 'OFFICIAL',
    provenance: fetchProvenance(
      SOURCE_ID,
      ctx,
      { countryCode, online: live.length, families },
      'entries with status "online" and this country code',
    ),
    note:
      'Botnet command-and-control servers HOSTED in this country and currently answering. ' +
      'This says where the machines are, not who operates them or where they are operated ' +
      'from — a compromised server at a hosting provider is the normal case. ' +
      (families.length === 0 ? '' : `Families seen: ${families.join(', ')}.`),
    format: (value: number) => value.toLocaleString('en-US'),
  };
}
