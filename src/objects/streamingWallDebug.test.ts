import { expect, test } from 'bun:test'

import { mergeActiveSectorSpans } from './streamingWallDebug'

test('mergeActiveSectorSpans merges contiguous sector ids', () => {
  expect(mergeActiveSectorSpans([3, 4, 5, 12, 13], 32)).toEqual([
    { startIndex: 3, count: 3 },
    { startIndex: 12, count: 2 }
  ])
})

test('mergeActiveSectorSpans returns an empty list when no active sectors exist', () => {
  expect(mergeActiveSectorSpans([], 32)).toEqual([])
  expect(mergeActiveSectorSpans([1, 2], 0)).toEqual([])
})
