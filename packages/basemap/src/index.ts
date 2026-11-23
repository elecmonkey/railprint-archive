export {
  buildBasemap,
  TERRAIN,
  type TerrainIndex,
  type TerrainSpec,
} from './build.ts';
export { rasterizeCoverage, type Grid } from './raster.ts';
export {
  readShapefile,
  type Ring,
  type ShapeRecord,
  type Shapefile,
} from './shapefile.ts';
export {
  hillshade,
  MAX_ELEVATION_M,
  packTerrain,
  readElevation,
} from './terrain.ts';
export {
  featureCollection,
  toLines,
  VECTOR_TOLERANCE,
  type VectorFeature,
} from './vector.ts';
export { unzip } from './zip.ts';
