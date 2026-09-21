import Particles from '../components/Particles';
import OxDNANucleotides from '../components/OxDNANucleotides';
import { parseRaspberryTopology } from './parsers/raspberry';
import { parseSRSSpringsTopology } from './parsers/srsSprings';
import { parseOxDNANucleotideTopology } from './parsers/oxdnaNucleotide';
import { parseFlavioTopology } from './parsers/flavio';
import { parseLorenzoTopology } from './parsers/lorenzo';

/**
 * Every supported topology format, in one table.
 *
 * Adding a format used to mean editing four places: an if-chain in
 * parseTopFile, a boolean in ParticleScene that picked the renderer, the
 * categorise switch in fileTypeDetector, and format-specific setup in App.
 * A format is now one entry here plus its parser.
 *
 * Fields:
 *   id        matches the id produced by fileTypeDetector
 *   parse     (content, { lines, fileMap, options }) => topology data
 *   matches   recognises already-parsed topology, for choosing the renderer
 *   renderer  the component that draws it
 *   onLoad    optional format-specific store setup after parsing
 */
export const FORMATS = [
  {
    id: 'oxdna_nucleotide',
    label: 'oxDNA nucleotide',
    parse: (content) => parseOxDNANucleotideTopology(content),
    matches: (topData) => !!topData?.nucleotides?.length,
    renderer: OxDNANucleotides,
  },
  {
    id: 'raspberry',
    label: 'Raspberry',
    parse: (content) => parseRaspberryTopology(content),
    // Recognised by its own renderer only through the default below; raspberry
    // particles are drawn by the patchy renderer, as beads.
    matches: () => false,
    renderer: Particles,
  },
  {
    id: 'srs_springs',
    label: 'SRS springs',
    parse: (content) => parseSRSSpringsTopology(content),
    matches: () => false,
    renderer: Particles,
    onLoad: (topData, { setParticleRadius }) => {
      // SRS encodes a per-particle radius in the topology itself. This arrives
      // as the format setter, so it also becomes the baseline that intrinsic
      // geometry is measured against rather than being applied on top of it.
      if (topData?.srsParticleRadius !== undefined) setParticleRadius(topData.srsParticleRadius);
    },
  },
  {
    id: 'flavio',
    label: 'Flavio',
    parse: (content, { fileMap, options }) => parseFlavioTopology(content, fileMap, options),
    matches: () => false,
    renderer: Particles,
  },
  {
    id: 'lorenzo',
    label: 'Lorenzo',
    parse: (content, { lines, fileMap }) => parseLorenzoTopology(lines, fileMap),
    matches: () => false,
    renderer: Particles,
  },
];

const BY_ID = new Map(FORMATS.map(f => [f.id, f]));

export const getFormat = (id) => BY_ID.get(id) || null;

/**
 * Chooses a renderer from parsed topology. Formats whose `matches` returns
 * true claim it; everything else is drawn by the patchy-particle renderer,
 * which is also what MGL and any topology-less scene gets.
 */
export function rendererFor(topData) {
  const format = FORMATS.find(f => f.matches(topData));
  return format ? format.renderer : Particles;
}

/**
 * Parses a topology file. `detectedFormat` comes from fileTypeDetector; when it
 * is absent we fall back to the original heuristic, which distinguishes Flavio
 * from Lorenzo by whether the second line contains a decimal point.
 */
export async function parseTopology(content, fileMap, detectedFormat = null, options = {}) {
  const lines = content.trim().split('\n');
  const ctx = { lines, fileMap, options };

  const format = getFormat(detectedFormat);
  if (format) return { data: await format.parse(content, ctx), format };

  const fallbackId = lines[1] && !lines[1].includes('.') ? 'flavio' : 'lorenzo';
  const fallback = getFormat(fallbackId);
  console.log(`Using fallback topology format detection: ${fallbackId}`);
  return { data: await fallback.parse(content, ctx), format: fallback };
}
