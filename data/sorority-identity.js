// Each sorority's look on its PhatFrats page: national colors, founding, flower and symbol, from the national
// organizations' own descriptions. Founding is for the national organization. Where a detail isn't well
// established it's left out, and chairs can pick their own colors in Settings.
const C = (name, hex) => ({ name, hex });
const WHITE = C('White', '#ffffff');
const PAN = 'Panhellenic sorority';
const NPHC = 'NPHC sorority';

module.exports = {
  1: { kind: PAN, colors: [C('Scarlet red', '#c8102e'), C('Olive green', '#708238')], founded: { year: 1885, place: 'DePauw University' }, flower: 'Red carnation', symbol: 'Lyre' },
  2: { kind: PAN, colors: [C('Azure blue', '#3a7bd5'), WHITE], founded: { year: 1851, place: 'Wesleyan College, Macon, Georgia' }, flower: 'Woodland violet', symbol: 'Lion' },
  3: { kind: NPHC, colors: [C('Salmon pink', '#f4a0a8'), C('Apple green', '#5aa846')], founded: { year: 1908, place: 'Howard University' }, flower: 'Pink tea rose', symbol: 'Ivy leaf' },
  4: { kind: PAN, colors: [C('Cardinal', '#c41e3a')], founded: { year: 1897, place: 'Barnard College' }, flower: 'Jacqueminot rose', symbol: 'Panda' },
  5: { kind: PAN, colors: [C('Bordeaux', '#7b1f3a'), C('Silver', '#c0c0c0')], founded: { year: 1872, place: 'Syracuse University' }, flower: 'Lily of the valley and forget-me-not', symbol: 'Ivy leaf' },
  6: { kind: PAN, colors: [C('Crimson', '#b0103a'), C('Palm green', '#3f7f3f'), C('Gold', '#d4af37')], founded: { year: 1901, place: 'Longwood University' }, flower: 'Narcissus and aster', symbol: 'Star and crown' },
  7: { kind: PAN, colors: [C('Light blue', '#8ab6e6'), C('Dark blue', '#1f3f7a'), C('Gold', '#d4af37')], founded: { year: 1893, place: 'Lombard College' }, flower: 'Pink rose', symbol: 'Quill' },
  8: { kind: PAN, colors: [C('Cardinal', '#b31b34'), C('Straw', '#e4d08a')], founded: { year: 1895, place: 'University of Arkansas' }, flower: 'White carnation', symbol: 'Owl' },
  9: { kind: PAN, colors: [C('Blue', '#2a5db0'), C('Gold', '#d4af37'), C('Silver', '#c0c0c0')], founded: { year: 1888, place: 'Boston University' }, flower: 'Pansy', symbol: 'Dolphin' },
  10: { kind: PAN, colors: [C('Bronze', '#b0793c'), C('Pink', '#f2a7c3'), C('Blue', '#6f9fd8')], founded: { year: 1873, place: 'Lewis School, Oxford, Mississippi' }, flower: 'Cream rose', symbol: 'Anchor' },
  11: { kind: PAN, colors: [C('Royal purple', '#5b2c83'), C('Pure gold', '#e3b23c')], founded: { year: 1917, place: 'New York University' } },
  12: { kind: PAN, colors: [C('Old rose', '#c08081'), C('Vieux green', '#5f7f5f')], founded: { year: 1902, place: 'Miami University' }, flower: 'Killarney rose', symbol: 'Turtle' },
  13: { kind: PAN, colors: [C('Light brown', '#b08860'), C('Dark brown', '#5b3a21')], founded: { year: 1874, place: 'Syracuse University' }, flower: 'Pink carnation', symbol: 'Crescent moon' },
  14: { kind: 'National service sorority', colors: [] },
  15: { kind: PAN, colors: [C('Black', '#1a1a1a'), C('Gold', '#e2b33c')], founded: { year: 1870, place: 'DePauw University' }, flower: 'Black and gold pansy', symbol: 'Kite' },
  16: { kind: 'Sorority', colors: [] },
  17: { kind: PAN, colors: [C('Olive green', '#6b7f3a'), C('Pearl white', '#f3efe6')], founded: { year: 1897, place: 'Longwood University' }, flower: 'White rose', symbol: 'Nautilus shell' },
  18: { kind: PAN, colors: [C('Dark blue', '#1f3f7a'), C('Light blue', '#8ab6e6')], founded: { year: 1870, place: 'Monmouth College' }, flower: 'Fleur-de-lis', symbol: 'Key' },
  19: { kind: 'National service sorority', colors: [], founded: { year: 1967, place: 'Bowling Green State University' } },
  20: { kind: PAN, colors: [C('Rose', '#e0457b'), WHITE], founded: { year: 1852, place: 'Wesleyan College, Macon, Georgia' }, flower: 'Pink carnation', symbol: 'Lion' },
  21: { kind: 'Engineering sorority', colors: [C('Wine', '#722f37'), C('Silver', '#c0c0c0')], founded: { year: 1984, place: 'Purdue University' } },
  22: { kind: PAN, colors: [C('King blue', '#1f4fb4'), C('Gold', '#e3b23c')], founded: { year: 1913, place: 'Hunter College' }, flower: 'American Beauty rose', symbol: 'Sphinx' },
  23: { kind: PAN, colors: [C('Wine', '#7b1f3a'), C('Silver blue', '#9fb4c8')], founded: { year: 1867, place: 'Monmouth College' }, flower: 'Wine carnation', symbol: 'Arrow' },
  24: { kind: 'Professional agricultural sorority', colors: [], founded: { year: 1978, place: 'Ohio State University' } },
  25: { kind: PAN, colors: [C('Old blue', '#5b7fa6'), C('Café au lait', '#a67b5b')], founded: { year: 1917, place: 'Cornell University' }, flower: 'Golden yellow tea rose', symbol: 'Torch' },
  26: { kind: NPHC, colors: [C('Royal blue', '#1f4fb4'), C('Gold', '#e3b23c')], founded: { year: 1922, place: 'Butler University' }, flower: 'Yellow tea rose', symbol: 'Poodle' },
  27: { kind: PAN, colors: [C('Maroon', '#7a1f2b'), C('Lavender', '#b49bd8')], founded: { year: 1874, place: 'Colby College' }, flower: 'Wild violet', symbol: 'Dove' },
  28: { kind: PAN, colors: [C('Royal purple', '#5b2c83'), WHITE], founded: { year: 1898, place: 'Longwood University' }, flower: 'Purple violet', symbol: 'Sailboat' },
  29: { kind: NPHC, colors: [C('Royal blue', '#1f4fb4'), WHITE], founded: { year: 1920, place: 'Howard University' }, flower: 'White rose', symbol: 'Dove' },
  30: { kind: PAN, colors: [C('Turquoise blue', '#30b5c8'), C('Steel gray', '#7d8a96')], founded: { year: 1898, place: 'Longwood University' }, flower: 'White violet', symbol: 'Crown' },
};
