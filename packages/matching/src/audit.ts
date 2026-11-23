import type { Catalog, PathsFile } from '@railprint/catalog';
import { speedPreference, type LineMatch, type Matcher } from './match.ts';

export interface AuditFinding {
  id: string;
  /** The confirmed result. */
  confirmed: LineMatch;
  /** A fresh route under the current rules, from the confirmed endpoints only. */
  fresh: LineMatch;
  reasons: string[];
}

export interface AuditOptions {
  /** Report a fresh route this much longer or shorter than the confirmed one. */
  lengthChange: number;
  /**
   * Lines preferring high-speed track are reported when a fresh route puts
   * at least this much more of the path on it. Many intercity lines are not
   * tagged highspeed=yes in OSM, so a low share alone proves nothing.
   */
  highSpeedGain: number;
}

export const DEFAULT_AUDIT: AuditOptions = {
  lengthChange: 0.03,
  highSpeedGain: 0.2,
};

/**
 * Re-check confirmed lines: route each again from its confirmed endpoints
 * under the current rules and compare with the stored path. Nothing is
 * changed; findings are for the author to decide on.
 */
export function audit(
  matcher: Matcher,
  catalog: Catalog,
  paths: PathsFile,
  options: AuditOptions = DEFAULT_AUDIT,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const line of catalog.lines) {
    const osm = line.osm;
    if (!osm?.confirmed) continue;
    const confirmed = matcher.match(line, osm, paths.lines[line.id]);
    const fresh = matcher.match(line, {
      ...(osm.from ? { from: osm.from } : {}),
      ...(osm.to ? { to: osm.to } : {}),
    });
    const reasons: string[] = [];
    const a = confirmed.path;
    const b = fresh.path;
    if (a && b) {
      const change = (b.lengthKm - a.lengthKm) / a.lengthKm;
      if (Math.abs(change) > options.lengthChange) {
        reasons.push(
          `按当前规则重新求路为 ${b.lengthKm} km，固定路径 ${a.lengthKm} km`,
        );
      }
      if (
        speedPreference(line) === 'high-speed' &&
        b.highSpeedShare - a.highSpeedShare >= options.highSpeedGain
      ) {
        reasons.push(
          `应走高铁轨道：固定路径 ${Math.round(a.highSpeedShare * 100)}% 在高铁轨道上，重算 ${Math.round(b.highSpeedShare * 100)}%`,
        );
      }
    }
    if (reasons.length)
      findings.push({ id: line.id, confirmed, fresh, reasons });
  }
  return findings;
}
