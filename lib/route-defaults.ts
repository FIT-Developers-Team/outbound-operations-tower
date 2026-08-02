import type { DestinationRule, Wave } from "./outbound-types";

/**
 * One physical route: it leaves in `wave`, runs in `routeNo` order, and unloads
 * at its destinations in listed order — index 0 is DROP 1, index 1 is DROP 2.
 * Wave and drop stay plain configuration text, so adding a route or a label
 * here never requires a code change anywhere else.
 */
export type RoutePlanEntry = {
  routeNo: number;
  wave: Wave;
  routeList: string;
  drops: string[];
};

export const defaultRoutePlan: RoutePlanEntry[] = [
  { routeNo: 1, wave: "WAVE 1", routeList: "SWL - PSG", drops: ["SWL", "PSG"] },
  { routeNo: 2, wave: "WAVE 1", routeList: "MRY - SMN", drops: ["MRY", "SMN"] },
  { routeNo: 3, wave: "WAVE 1", routeList: "CSA - KLD", drops: ["CSA", "KLD"] },
  { routeNo: 4, wave: "WAVE 1", routeList: "TGX - JBG", drops: ["TGX", "JBG"] },
  { routeNo: 5, wave: "WAVE 1", routeList: "BSX", drops: ["BSX"] },
  { routeNo: 6, wave: "WAVE 1", routeList: "CPT - PPL", drops: ["CPT", "PPL"] },
  { routeNo: 7, wave: "WAVE 1", routeList: "SWG - LIM - BGR3", drops: ["SWG", "LIM"] },
  { routeNo: 8, wave: "WAVE 1", routeList: "RDS - SLP", drops: ["RDS", "SLP"] },
  { routeNo: 9, wave: "WAVE 1+", routeList: "JLB", drops: ["JLB"] },
  { routeNo: 10, wave: "WAVE 1+", routeList: "PPN - TAP", drops: ["PPN", "TAP"] },
  { routeNo: 11, wave: "WAVE 1+", routeList: "CLN - PIN", drops: ["CLN", "PIN"] },
  { routeNo: 12, wave: "WAVE 2", routeList: "PLB - KPM", drops: ["PLB", "KPM"] },
  { routeNo: 13, wave: "WAVE 2", routeList: "PBT", drops: ["PBT"] },
  { routeNo: 14, wave: "WAVE 2", routeList: "SAL", drops: ["SAL"] },
  { routeNo: 15, wave: "WAVE 2", routeList: "DNS", drops: ["DNS"] },
  { routeNo: 16, wave: "WAVE 2", routeList: "TDN", drops: ["TDN"] },
  { routeNo: 17, wave: "WAVE 2", routeList: "CNR", drops: ["CNR"] },
  { routeNo: 18, wave: "WAVE 2", routeList: "GPL", drops: ["GPL"] },
  { routeNo: 19, wave: "WAVE 2", routeList: "LBB - MGR", drops: ["LBB", "MGR"] },
  { routeNo: 20, wave: "WAVE 2", routeList: "BDC - BS9", drops: ["BDC", "BS9"] },
  { routeNo: 21, wave: "WAVE 3", routeList: "MTG - GMD", drops: ["MTG", "GMD"] },
  { routeNo: 22, wave: "WAVE 3", routeList: "PGD - KLN", drops: ["PGD", "KLN"] },
  { routeNo: 23, wave: "WAVE 3", routeList: "PAM - PKC", drops: ["PAM", "PKC"] },
  { routeNo: 24, wave: "WAVE 3", routeList: "CNR 2 - FTW", drops: ["CNR", "FTW"] },
  { routeNo: 25, wave: "WAVE 3", routeList: "SRP - BGS", drops: ["SRP", "BGS"] },
  { routeNo: 26, wave: "WAVE 3", routeList: "CGS - MRG - BGR 1", drops: ["CGS", "MRG"] },
  { routeNo: 27, wave: "WAVE 3", routeList: "BRY - APR", drops: ["BRY", "APR"] },
  { routeNo: 28, wave: "WAVE 3", routeList: "KGS - CT2", drops: ["KGS", "CT2"] },
  { routeNo: 29, wave: "WAVE 4", routeList: "JTI", drops: ["JTI"] },
  { routeNo: 30, wave: "WAVE 4", routeList: "GWB", drops: ["GWB"] },
  { routeNo: 31, wave: "WAVE 4", routeList: "CAM", drops: ["CAM"] },
  { routeNo: 32, wave: "WAVE 4", routeList: "CWG", drops: ["CWG"] },
  { routeNo: 33, wave: "WAVE 4", routeList: "BKJ", drops: ["BKJ"] },
  { routeNo: 34, wave: "WAVE 4", routeList: "MSB", drops: ["MSB"] },
  { routeNo: 35, wave: "WAVE 4", routeList: "KJT", drops: ["KJT"] },
  { routeNo: 36, wave: "WAVE 4", routeList: "DST", drops: ["DST"] },
  { routeNo: 37, wave: "WAVE 4+", routeList: "HBD", drops: ["HBD"] },
  { routeNo: 38, wave: "WAVE 4+", routeList: "TSY", drops: ["TSY"] },
  { routeNo: 39, wave: "WAVE 4+", routeList: "ASA", drops: ["ASA"] },
];

export function dropLabel(index: number) {
  return `DROP ${index + 1}`;
}

/**
 * Expand the route plan into the per-destination rules the app stores. An id
 * already held by a destination in the same month is reused, so applying the
 * plan a second time edits that row instead of stacking a duplicate beside it.
 */
export function buildRoutePlanRules({
  effectiveMonth,
  existing = [],
  destinationNames,
  plan = defaultRoutePlan,
}: {
  effectiveMonth: string;
  existing?: DestinationRule[];
  destinationNames?: Map<string, string>;
  plan?: RoutePlanEntry[];
}): DestinationRule[] {
  const reusableIds = new Map<string, string[]>();
  const knownNames = new Map<string, string>();
  [...existing]
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .forEach((rule) => {
      const code = rule.destinationCode.toUpperCase();
      if (rule.destinationName && rule.destinationName !== code) {
        knownNames.set(code, rule.destinationName);
      }
      if (rule.effectiveMonth !== effectiveMonth) return;
      reusableIds.set(code, [...(reusableIds.get(code) ?? []), rule.id]);
    });

  return plan.flatMap((route) =>
    route.drops.map((drop, index) => {
      const code = drop.trim().toUpperCase();
      return {
        id:
          reusableIds.get(code)?.shift() ??
          `RT-${effectiveMonth}-${String(route.routeNo).padStart(2, "0")}-${code}`,
        effectiveMonth,
        destinationCode: code,
        destinationName:
          destinationNames?.get(code) ?? knownNames.get(code) ?? code,
        wave: route.wave,
        drop: dropLabel(index),
        sequence: route.routeNo,
        active: true,
      };
    }),
  );
}

/**
 * Split candidate rules against what is already stored so the operator sees
 * what an apply would change, and so only the differing rows travel to the
 * server.
 */
export function diffDestinationRules(
  next: DestinationRule[],
  existing: DestinationRule[],
) {
  const byId = new Map(existing.map((rule) => [rule.id, rule]));
  const added: DestinationRule[] = [];
  const updated: DestinationRule[] = [];
  const unchanged: DestinationRule[] = [];
  next.forEach((rule) => {
    const current = byId.get(rule.id);
    if (!current) {
      added.push(rule);
      return;
    }
    const identical =
      current.effectiveMonth === rule.effectiveMonth &&
      current.destinationCode === rule.destinationCode &&
      current.destinationName === rule.destinationName &&
      current.wave === rule.wave &&
      current.drop === rule.drop &&
      current.sequence === rule.sequence &&
      current.active === rule.active;
    (identical ? unchanged : updated).push(rule);
  });
  return { added, updated, unchanged, pending: [...added, ...updated] };
}
