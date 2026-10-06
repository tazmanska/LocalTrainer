import type { Session } from '../shared/session.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** TCX: format Garmina, przyjmowany przez Strava, Garmin Connect i TrainingPeaks; nie wymaga pozycji GPS. */
export function toTcx(s: Session): string {
  const start = Date.parse(s.startedAt);
  const sum = s.summary;
  const points = s.samples
    .map((p) => {
      const parts = [`<Time>${iso(start + p.t * 1000)}</Time>`];
      if (p.hr) parts.push(`<HeartRateBpm><Value>${Math.round(p.hr)}</Value></HeartRateBpm>`);
      if (p.cadence !== null) parts.push(`<Cadence>${Math.min(254, Math.round(p.cadence))}</Cadence>`);
      if (p.power !== null) parts.push(`<Extensions><ns3:TPX><ns3:Watts>${Math.round(p.power)}</ns3:Watts></ns3:TPX></Extensions>`);
      return `          <Trackpoint>${parts.join('')}</Trackpoint>`;
    })
    .join('\n');
  const hr = [
    sum.avgHr ? `        <AverageHeartRateBpm><Value>${sum.avgHr}</Value></AverageHeartRateBpm>` : '',
    sum.maxHr ? `        <MaximumHeartRateBpm><Value>${sum.maxHr}</Value></MaximumHeartRateBpm>` : '',
  ].filter(Boolean);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">',
    '  <Activities>',
    '    <Activity Sport="Biking">',
    `      <Id>${iso(start)}</Id>`,
    `      <Lap StartTime="${iso(start)}">`,
    `        <TotalTimeSeconds>${sum.duration}</TotalTimeSeconds>`,
    '        <DistanceMeters>0</DistanceMeters>',
    // przy sprawności ok. 24% kJ pracy na pedałach ≈ kcal spalonych
    `        <Calories>${sum.work}</Calories>`,
    ...hr,
    '        <Intensity>Active</Intensity>',
    ...(sum.avgCadence ? [`        <Cadence>${sum.avgCadence}</Cadence>`] : []),
    '        <TriggerMethod>Manual</TriggerMethod>',
    '        <Track>',
    points,
    '        </Track>',
    '      </Lap>',
    `      <Notes>${esc(s.workoutName)}</Notes>`,
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
    '',
  ].join('\n');
}

/**
 * GPX z rozszerzeniami Garmina (tętno, kadencja, moc). GPX wymaga współrzędnych,
 * więc trening stacjonarny dostaje stały punkt 0,0; do Stravy lepiej wysyłać TCX.
 */
export function toGpx(s: Session): string {
  const start = Date.parse(s.startedAt);
  const points = s.samples
    .map((p) => {
      const ext: string[] = [];
      if (p.power !== null) ext.push(`<power>${Math.round(p.power)}</power>`);
      const tpx: string[] = [];
      if (p.hr) tpx.push(`<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`);
      if (p.cadence !== null) tpx.push(`<gpxtpx:cad>${Math.round(p.cadence)}</gpxtpx:cad>`);
      if (tpx.length) ext.push(`<gpxtpx:TrackPointExtension>${tpx.join('')}</gpxtpx:TrackPointExtension>`);
      return `      <trkpt lat="0" lon="0"><time>${iso(start + p.t * 1000)}</time>${ext.length ? `<extensions>${ext.join('')}</extensions>` : ''}</trkpt>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trenazer" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    `  <metadata><name>${esc(s.workoutName)}</name><time>${iso(start)}</time></metadata>`,
    '  <trk>',
    `    <name>${esc(s.workoutName)}</name>`,
    '    <type>VirtualRide</type>',
    '    <trkseg>',
    points,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
