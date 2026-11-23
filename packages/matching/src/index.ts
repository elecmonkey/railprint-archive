export {
  lineKey,
  lineKeyString,
  placeKey,
  type LineClass,
  type LineKey,
} from './names.ts';
export { PlaceIndex, type PlaceMatch } from './places.ts';
export {
  confirmMatch,
  DEFAULT_THRESHOLDS,
  Matcher,
  PIN_RELATION_SHARE,
  type EndpointResult,
  type Issue,
  type IssueCode,
  type LineMatch,
  type MatchStatus,
  type MatchThresholds,
  type PathSegment,
  type PlaceRef,
  type RelationRef,
  type RelationShare,
} from './match.ts';
export { buildReport, renderMarkdown, type MatchReport } from './report.ts';
export {
  loadMapping,
  loadPaths,
  MAPPING_FILE,
  PATHS_FILE,
  savePaths,
  serializePaths,
  type PathsFile,
  type StoredSegment,
  parseMapping,
  parseRef,
  saveMapping,
  type EndpointPin,
  type LineMapping,
  type MappingFile,
  type OsmRef,
  type RelationPin,
} from './mapping.ts';
