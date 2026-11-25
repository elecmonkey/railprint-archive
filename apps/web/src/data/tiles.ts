/**
 * Where the terrain tiles are served, and the hash of the tiles this build
 * was made with (packages/tiles/version.json); see rstack.config.ts.
 */
export const TILES = {
  url: import.meta.env.TILES_URL as string,
  hash: import.meta.env.TILES_HASH as string,
};
