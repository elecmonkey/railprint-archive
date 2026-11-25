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
  speedPreference,
  type SpeedPreference,
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
export { overlaps, type Overlap } from './overlaps.ts';
export {
  audit,
  DEFAULT_AUDIT,
  type AuditFinding,
  type AuditOptions,
} from './audit.ts';
