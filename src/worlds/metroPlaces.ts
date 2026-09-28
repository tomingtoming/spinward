import catalog from './generated/metroPlaces.json'

// JSON object member order is not part of a geographical coordinate frame.
// Immutable release serialization may sort keys without changing coordinates.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value

export type MetroStudyFrame = { radius: number; span: number; samples: { id: string; band: number; frame: unknown }[] }

/** Geographic coordinates are only valid for the crop that produced them. */
export function matchesMetroFrames(study: MetroStudyFrame, generated: { radius: number; span: number; frames: unknown }) {
  const frames = study.samples.map(s => [s.id, s.band, s.frame])
  return study.radius === generated.radius && study.span === generated.span &&
    JSON.stringify(canonical(frames)) === JSON.stringify(canonical(generated.frames))
}

export function metroPlacesForStudy(study: MetroStudyFrame) {
  return matchesMetroFrames(study, catalog) ? catalog.places : []
}
