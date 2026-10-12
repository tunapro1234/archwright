// Two real arches close worlds 1 and 2: a level shaped like each (semicircular, then pointed) and a
// small stone plaque with the facts. Every value here is sourced (arastirma/anitlar.md in the project
// notes; the links below); nothing else about them, such as a height, is claimed. The game scale is
// not the real scale: only the shape of the arch and its real span are on the plaque, marked "≈".
// The levels themselves are in src/levels/index.ts, right after their world.

export interface Monument {
  id: string;
  levelId: 'm-tiberio' | 'm-malabadi';
  name: string;
  place: string;
  built: string;
  shape: 'semicircular' | 'pointed';
  spanM: number; // the real (longest) span in metres, from the sources
  sources: { title: string; url: string }[];
}

export const MONUMENTS: Monument[] = [
  {
    id: 'tiberio',
    levelId: 'm-tiberio',
    name: 'Ponte di Tiberio',
    place: 'Rimini',
    built: 'AD 14–21',
    shape: 'semicircular',
    spanM: 10.6,
    sources: [{ title: 'Ponte di Tiberio (Rimini), Wikipedia', url: 'https://en.wikipedia.org/wiki/Ponte_di_Tiberio_(Rimini)' }],
  },
  {
    id: 'malabadi',
    levelId: 'm-malabadi',
    name: 'Malabadi Bridge',
    place: 'Silvan, Diyarbakır',
    built: 'c. 1147–1154',
    shape: 'pointed',
    spanM: 38.6,
    sources: [
      { title: 'Köprü (Kazım Çeçen), TDV İslâm Ansiklopedisi', url: 'https://islamansiklopedisi.org.tr/kopru' },
      { title: 'Malabadi Bridge, Wikipedia', url: 'https://en.wikipedia.org/wiki/Malabadi_Bridge' },
    ],
  },
];

/** The monument a level belongs to, if any. */
export function monumentOf(levelId: string): Monument | undefined {
  return MONUMENTS.find(m => m.levelId === levelId);
}

/** The plaque's two lines: name, place and date; then the arch's shape and its real span. No links. */
export function plaqueText(m: Monument): [string, string] {
  // Ponte di Tiberio has five arches; the span given is its longest.
  const shape = m.levelId === 'm-tiberio' ? `${m.shape} arches · longest span` : `${m.shape} arch · span`;
  return [`${m.name} · ${m.place} · ${m.built}`, `${shape} ≈ ${m.spanM} m`];
}
