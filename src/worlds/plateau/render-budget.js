// Budgets belong to the streamed city as well as the framebuffer. Keep source
// ground/collision and the complete three-band overview on every device.
export function metroRenderBudget(tier='desktop'){
  const quest=tier==='quest'
  return {
    tier:quest?'quest':'default',
    near:quest?{maxResident:9,maxConcurrent:1,loadDistance:90,evictDistance:160}: {},
    far:quest?{maxBytes:16*1024*1024,maxResident:12,maxConcurrent:1,loadDistance:1400,evictDistance:1800}: {},
    lowrise:quest?{maxBytes:4*1024*1024,maxResident:16,fadeStart:1200,fadeEnd:1800}: {},
    // Facade catalogs use small source tiles (24 residents in the release).
    // Keep their source-defined coverage so nearby buildings never lose windows.
    facades:quest?{maxConcurrent:1}: {},
    panes:quest?{maxBytes:4*1024*1024,maxResident:32,loadDistance:1500}: {},
    flatOpenings:quest,
    batchFacades:quest,
    overviewTilesPerChunk:quest?10:0,
    overviewTextureScale:quest?.5:1,
    // Stable LOD is position-dependent, not head-direction-dependent. A short
    // selection interval removes repeated catalog scans without slowing pose.
    lodIntervalMs:quest?100:0
  }
}
