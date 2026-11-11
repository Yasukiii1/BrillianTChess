// A small opening book. Moves that follow one of these lines are marked "Book",
// and the longest matching line names the opening.
export const OPENINGS = [
  ['King\'s Pawn Opening', 'e4'],
  ['King\'s Pawn Game', 'e4 e5'],
  ['Queen\'s Pawn Opening', 'd4'],
  ['Queen\'s Pawn Game', 'd4 d5'],
  ['Indian Defense', 'd4 Nf6'],
  ['English Opening', 'c4'],
  ['English: Reversed Sicilian', 'c4 e5'],
  ['Zukertort Opening', 'Nf3'],
  ['Réti Opening', 'Nf3 d5 c4'],
  ['Bird\'s Opening', 'f4'],
  ['Italian Game', 'e4 e5 Nf3 Nc6 Bc4 Bc5'],
  ['Italian: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3'],
  ['Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4'],
  ['Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
  ['Fried Liver Attack', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7'],
  ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7'],
  ['Ruy Lopez: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4'],
  ['Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4'],
  ['Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'],
  ['Petrov\'s Defense', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4'],
  ['Philidor Defense', 'e4 e5 Nf3 d6 d4'],
  ['King\'s Gambit', 'e4 e5 f4 exf4'],
  ['Vienna Game', 'e4 e5 Nc3 Nf6'],
  ['Danish Gambit', 'e4 e5 d4 exd4 c3'],
  ['Center Game', 'e4 e5 d4 exd4 Qxd4'],
  ['Sicilian Defense', 'e4 c5'],
  ['Sicilian: Alapin', 'e4 c5 c3'],
  ['Sicilian: Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
  ['Sicilian: Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],
  ['Sicilian: Open', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4'],
  ['Sicilian: Kan/Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4'],
  ['French Defense', 'e4 e6 d4 d5'],
  ['French: Advance', 'e4 e6 d4 d5 e5 c5'],
  ['French: Winawer', 'e4 e6 d4 d5 Nc3 Bb4'],
  ['Caro-Kann Defense', 'e4 c6 d4 d5'],
  ['Caro-Kann: Advance', 'e4 c6 d4 d5 e5 Bf5'],
  ['Caro-Kann: Classical', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'],
  ['Scandinavian Defense', 'e4 d5 exd5 Qxd5 Nc3 Qa5'],
  ['Alekhine\'s Defense', 'e4 Nf6 e5 Nd5'],
  ['Pirc Defense', 'e4 d6 d4 Nf6 Nc3 g6'],
  ['Modern Defense', 'e4 g6 d4 Bg7'],
  ['Queen\'s Gambit Declined', 'd4 d5 c4 e6 Nc3 Nf6'],
  ['Queen\'s Gambit Accepted', 'd4 d5 c4 dxc4'],
  ['Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6'],
  ['London System', 'd4 d5 Bf4 Nf6 e3 e6 Nf3'],
  ['London System', 'd4 Nf6 Bf4'],
  ['King\'s Indian Defense', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6'],
  ['Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5'],
  ['Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4'],
  ['Queen\'s Indian Defense', 'd4 Nf6 c4 e6 Nf3 b6'],
  ['Catalan Opening', 'd4 Nf6 c4 e6 g3 d5'],
  ['Benoni Defense', 'd4 Nf6 c4 c5 d5'],
  ['Dutch Defense', 'd4 f5'],
].map(([name, line]) => ({ name, moves: line.split(' ') }));

/** For a list of SAN moves from the start position: which plies are book, and the opening name. */
export function bookInfo(sans) {
  let bookPlies = 0, name = null, nameLen = 0;
  for (const o of OPENINGS) {
    let k = 0;
    while (k < o.moves.length && k < sans.length && o.moves[k] === sans[k]) k++;
    if (k > bookPlies) bookPlies = k;
    if (k === o.moves.length && k > nameLen) { name = o.name; nameLen = k; }
  }
  return { bookPlies, name };
}
