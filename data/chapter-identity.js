// Each chapter's look in the frat portal: its national colors and founding. Colors come from the national
// organizations (checked against their own sites, university Greek life pages and Wikipedia).
// Two Penn State chapters have no published colors; their leaders can pick colors in the portal's Settings.
// Founding details are for the national organization unless the note says otherwise.
const C = (name, hex) => ({ name, hex });
const WHITE = C('White', '#ffffff');

module.exports = {
  1: { colors: [C('Garnet', '#7b1e2e'), WHITE], founded: { year: 1895, place: 'Trinity College, Hartford' } },
  2: { colors: [C('Emerald green', '#1e8449'), WHITE], founded: { year: 1832, place: 'Hamilton College' } },
  3: { colors: [C('Blue', '#1f4e9b'), C('Gold', '#e3b23c')], founded: { year: 1913, place: 'New York University' } },
  4: { colors: [C('Growing green', '#2e7d32'), C('Harvest gold', '#d4a017')], founded: { year: 1904, place: 'Ohio State University' }, kind: 'Agricultural fraternity' },
  5: { colors: [C('Purple', '#5b2a86'), C('Gold', '#e2b33c')], founded: { year: 1914, place: 'University of California, Berkeley' } },
  6: { colors: [C('Royal purple', '#5b2c83'), WHITE], founded: { year: 1914, place: 'Syracuse University' } },
  7: { colors: [C('Azure', '#2e6fd8'), C('Sanguine', '#9b111e')], founded: { year: 1914, place: 'Chicago' }, kind: 'Architecture fraternity' },
  8: { colors: [C('Cardinal', '#c41e3a'), C('Stone gray', '#8e8e8e')], founded: { year: 1845, place: 'Yale University' } },
  9: { colors: [C('Azure', '#3a75c4'), C('Gold', '#e6b422')], founded: { year: 1865, place: 'Richmond, Virginia' } },
  10: { colors: [C('Old gold', '#c9a227'), C('Sky blue', '#87ceeb')], founded: { year: 1897, place: 'Ohio State University' }, kind: 'Agriculture fraternity' },
  11: { colors: [], founded: { year: 1913, place: 'Penn State, as the Beta chapter of Beta Sigma Rho' }, kind: 'Penn State local fraternity', local: true },
  12: { colors: [C('Scarlet', '#cc1f2f'), C('Blue', '#1f4b9b')], founded: { year: 1824, place: 'Princeton' } },
  13: { colors: [C('Nile green', '#7fb58a'), WHITE], founded: { year: 1899, place: 'City College of New York' } },
  14: { colors: [C('Black', '#111111'), WHITE, C('Gold', '#d4af37')], founded: { year: 1869, place: 'Virginia Military Institute' } },
  15: { colors: [C('Old gold', '#cfb53b'), C('Sapphire blue', '#0f52ba')], founded: { year: 1834, place: 'Williams College' } },
  16: { colors: [C('National blue', '#1f4e9b'), C('Corn gold', '#e3b23c')], founded: { year: 1906, place: 'Ohio State University' }, kind: 'Agricultural fraternity' },
  17: { colors: [C('Black', '#111111'), WHITE, C('Blue', '#2c5aa0')], founded: { year: 1847, place: 'Union College' } },
  18: { colors: [C('Lavender', '#b57edc'), WHITE], founded: { year: 1910, place: 'Columbia University' } },
  19: { colors: [C('Royal purple', '#6a2c91')], founded: { year: 1848, place: 'Jefferson College' } },
  20: { colors: [C('Cardinal red', '#b31b1b'), C('Hunter green', '#355e3b')], founded: { year: 1852, place: 'Jefferson College' } },
  21: { colors: [C('Blue', '#1f4e9b'), WHITE], founded: { year: 1898, place: 'New York City' } },
  22: { colors: [C('Harvard red', '#a51c30'), C('Old gold', '#cfb53b')], founded: { year: 1906, place: 'Miami University' } },
  23: { colors: [C('Cardinal purple', '#6e2c6e'), C('Gold', '#d4af37'), WHITE], founded: { year: 1959, place: 'Ohio State University, uniting Phi Kappa (Brown, 1889) and Theta Kappa Phi (Lehigh)' } },
  24: { colors: [C('Magenta', '#c2185b'), C('Silver', '#c0c0c0')], founded: { year: 1873, place: 'Massachusetts Agricultural College' } },
  25: { colors: [C('Gold', '#d4af37'), WHITE, C('Royal blue', '#2647a3')], founded: { year: 1904, place: 'College of Charleston' } },
  26: { colors: [C('Royal purple', '#5b2c83'), C('Old gold', '#cfb53b')], founded: { year: 1856, place: 'University of Alabama' } },
  27: { colors: [C('Purple', '#5e2d79'), C('Red', '#c8102e')], founded: { year: 1901, place: 'Richmond College' } },
  28: { colors: [C('Purple', '#5b2c83'), C('Green', '#2e7d32'), C('Gold', '#d4af37')], founded: { year: 1909, place: 'Boston University' } },
  29: { colors: [], founded: { year: 1924, place: 'nationally, from Penn State\'s Kappa Phi Delta forestry club (1922)' }, kind: 'Forestry fraternity' },
  30: { colors: [C('Military red', '#b22234'), WHITE], founded: { year: 1856, place: 'Norwich University' } },
  31: { colors: [C('Azure', '#3a75c4'), C('Argent', '#c0c0c0')], founded: { year: 1848, place: 'Miami University' } },
  32: { colors: [C('Old rose', '#c08081'), C('Gray', '#8e8e8e')], founded: { year: 1907, place: 'University of Illinois' }, kind: 'Fraternity for engineers, architects and scientists' },
  33: { colors: [C('Scarlet', '#cc1f2f'), WHITE, C('Emerald green', '#1e8449')], founded: { year: 1869, place: 'University of Virginia' } },
  34: { colors: [C('Azure', '#3a75c4'), C('Gold', '#d4af37'), C('Crimson', '#b11226')], founded: { year: 1844, place: 'Yale University' } },
};
