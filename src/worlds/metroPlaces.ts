import catalog from './generated/metroPlaces.json'

// JSON object member order is not part of a geographical coordinate frame.
// Immutable release serialization may sort keys without changing coordinates.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value

/** Geographic coordinates are only valid for the crop that produced them. */
export function metroPlacesForStudy(study: { radius: number; span: number; samples: { id: string; band: number; frame: unknown }[] }) {
  const frames = study.samples.map(s => [s.id, s.band, s.frame])
  return study.radius === catalog.radius && study.span === catalog.span &&
    JSON.stringify(canonical(frames)) === JSON.stringify(canonical(catalog.frames)) ? catalog.places : []
}
