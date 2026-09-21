import { parseOxDNANucleotideTopology } from './oxdnaNucleotide';

const top = (rows, header = `${rows.length} 2`) => [header, ...rows].join('\n');

describe('parseOxDNANucleotideTopology', () => {
  it('reads one nucleotide per body line', () => {
    const out = parseOxDNANucleotideTopology(top([
      '1 A -1 1',
      '1 G 0 2',
      '1 C 1 -1',
    ]));
    expect(out.nucleotides).toHaveLength(3);
    expect(out.nucleotides[0]).toEqual({ index: 0, strandId: 1, base: 'A', n3: -1, n5: 1 });
    expect(out.nucleotides[2]).toEqual({ index: 2, strandId: 1, base: 'C', n3: 1, n5: -1 });
  });

  it('indexes nucleotides from zero, independent of strand', () => {
    // The index is the position in the trajectory, which is what every renderer
    // and the picking service key on.
    const out = parseOxDNANucleotideTopology(top([
      '1 A -1 -1',
      '2 T -1 -1',
    ]));
    expect(out.nucleotides.map(n => n.index)).toEqual([0, 1]);
  });

  it('upper-cases the base so colouring does not depend on file casing', () => {
    const out = parseOxDNANucleotideTopology(top(['1 a -1 -1', '1 t -1 -1']));
    expect(out.nucleotides.map(n => n.base)).toEqual(['A', 'T']);
  });

  it('reports the format, which is what selects the renderer', () => {
    // ParticleScene picks OxDNANucleotides over Particles from this.
    const out = parseOxDNANucleotideTopology(top(['1 A -1 -1']));
    expect(out.format).toBe('oxdna_nucleotide');
  });

  it('gives every strand its own type index, in strand order', () => {
    const out = parseOxDNANucleotideTopology(top([
      '3 A -1 -1',
      '1 T -1 -1',
      '2 G -1 -1',
    ]));
    // Strands 1, 2, 3 sorted ascending map to type 0, 1, 2 — so colour cycling
    // does not depend on which strand happens to appear first in the file.
    const typeOf = (i) => out.particleTypeMapping[i].typeIndex;
    expect(typeOf(1)).toBe(0);   // strand 1
    expect(typeOf(2)).toBe(1);   // strand 2
    expect(typeOf(0)).toBe(2);   // strand 3
  });

  it('skips comment and blank lines', () => {
    const out = parseOxDNANucleotideTopology([
      '2 1',
      '# a comment',
      '1 A -1 1',
      '',
      '1 G 0 -1',
    ].join('\n'));
    expect(out.nucleotides).toHaveLength(2);
  });

  it('ignores a body line with too few tokens rather than emitting NaN', () => {
    const out = parseOxDNANucleotideTopology(top(['1 A -1 1', '1 G', '1 C 1 -1']));
    expect(out.nucleotides).toHaveLength(2);
    expect(out.nucleotides.every(n => Number.isInteger(n.strandId))).toBe(true);
  });

  it('keeps -1 chain-end markers rather than coercing them', () => {
    // OxDNANucleotides draws a backbone connector only where n3 is a real
    // index; a 0 here would draw a bond to particle 0 from every chain end.
    const out = parseOxDNANucleotideTopology(top(['1 A -1 -1']));
    expect(out.nucleotides[0].n3).toBe(-1);
    expect(out.nucleotides[0].n5).toBe(-1);
  });
});
