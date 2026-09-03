// Where the flat-screen UI switches to its compact arrangement.
//
// Measured on a 390x664 phone (iPhone 13, 2026-09-03): the dock wrapped to
// four rows and the bottom UI ate 29% of the viewport, because the left and
// right clusters share one flex row and neither gets enough width. Below this
// width the clusters stack (each gets the full width) and the five Travel
// destinations collapse behind one pill.
export const COMPACT_DOCK_MAX_WIDTH = 720

export const isCompactDock = (viewportWidth: number): boolean =>
  viewportWidth > 0 && viewportWidth <= COMPACT_DOCK_MAX_WIDTH
