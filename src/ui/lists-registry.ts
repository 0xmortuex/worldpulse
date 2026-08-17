/**
 * The list registry, alone in its own module so that naming a list is cheap.
 *
 * ## Why this is separate from `lists.ts`
 *
 * The command palette builds its commands from this registry rather than from a
 * hand-written array — that is the property that stops the palette drifting
 * into a second, stale description of what the app can do. But importing it
 * from `lists.ts` also imported the whole lists SURFACE: four table renderers,
 * the sources registry read, the watchlist. The palette is loaded at boot, so
 * that pulled every byte of the lists views into the entry chunk even though
 * nothing shows them until a reader clicks.
 *
 * Splitting the *declaration* from the *rendering* keeps both properties: the
 * palette still reads the one true list of lists, and the views themselves load
 * when they are opened.
 *
 * Four lines in their own file looks like over-separation until you notice it
 * is the difference between shipping the lists surface to every reader and
 * shipping it to the ones who ask for it.
 */

export type ListId = 'events' | 'countries' | 'sources' | 'watchlist';

export const LISTS: ReadonlyArray<{ id: ListId; label: string }> = [
  { id: 'events', label: 'Events' },
  { id: 'countries', label: 'Countries' },
  { id: 'sources', label: 'Sources' },
  { id: 'watchlist', label: 'Watchlist' },
];
