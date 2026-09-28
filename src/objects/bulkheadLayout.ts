/** Six land/window boundaries carry the main ribs; six strip centres carry
 * secondary ribs. Shared by relief geometry and the wall's surface pattern. */
export const BULKHEAD_SECTORS = 12
export const BULKHEAD_SECTOR_ANGLE = Math.PI * 2 / BULKHEAD_SECTORS
export const BULKHEAD_PRIMARY_OFFSET = Math.PI / 6
