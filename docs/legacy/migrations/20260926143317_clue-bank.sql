-- =============================================================================
-- Technical Tambola — the clue bank
-- =============================================================================
-- Every clue decodes to a number between 1 and 90. The host reveals the clue
-- first, gives players a few seconds to decode it, then reveals the number.
-- Two variants per number so a repeat call never sounds the same.
-- =============================================================================

INSERT INTO public.tambola_clue_bank (number, variant, text) VALUES
  (1,  1, 'I am the only number that is neither prime nor composite'),
  (1,  2, '1-based indexing: the first element of your array'),

  (2,  1, '200 OK - the HTTP status code everybody celebrates'),
  (2,  2, 'binary 10 in decimal'),

  (3,  1, '=== has exactly this many equals signs'),
  (3,  2, 'A triangle has this many sides, and a tri-state commit has this many parents'),

  (4,  1, '404 - Not Found'),
  (4,  2, 'An IPv4 address is this many bytes long'),

  (5,  1, '500 - Internal Server Error'),
  (5,  2, 'pentagon, pentathlon, and the fingers on one hand'),

  (6,  1, 'IPv6 - the successor to IPv4'),
  (6,  2, 'A hexagon has this many sides, and one hex digit encodes 4 bits'),

  (7,  1, 'The OSI model stack has exactly this many layers'),
  (7,  2, 'A week has this many days, and a heptad is the memory term for seven'),

  (8,  1, '8 bits make a byte'),
  (8,  2, '8080 - the port every developer memorises'),

  (9,  1, 'ASCII 9 is the TAB key'),
  (9,  2, '3 x 3 - the nine-cell grid of a Sudoku box'),

  (10, 1, '1024 is 2 raised to this power'),
  (10, 2, 'Decima: we count in base ten'),

  (11, 1, 'binary 1011 in decimal'),
  (11, 2, 'Eleven players on the pitch, not counting the referee'),

  (12, 1, 'The 12-factor app manifesto behind every cloud-native service'),
  (12, 2, 'A dozen, and 24 hours is 2 x this'),

  (13, 1, 'Triskaidekaphobia: the fear of this unlucky number'),
  (13, 2, 'Unlucky in the USA and China, lucky in Italy'),

  (14, 1, 'pi, rounded to two decimal places'),
  (14, 2, 'A fortnight is this many days'),

  (15, 1, '0xF in decimal'),
  (15, 2, '0b1111 - four 1-bits packed into a single nibble'),

  (16, 1, '0x10 in hex'),
  (16, 2, '16 x 16 = 256, the classic IPv4 address space'),

  (17, 1, 'The 17th letter of the alphabet: Q'),
  (17, 2, '2^17 = 131072'),

  (18, 1, '18 - the age of majority in India'),
  (18, 2, 'Node.js ships 3.6.18, so the release train is named after 18'),

  (19, 1, 'TCP port 19 is the chargen service'),
  (19, 2, '2^19 = 524288'),

  (20, 1, '20/20 vision, and 4 x 5 is a rectangle of ticket cells'),
  (20, 2, '0x14 in hex'),

  (21, 1, 'The Blackjack hand that beats the dealer'),
  (21, 2, '2^21 = 2097152, exactly two million'),

  (22, 1, '22 is the port SSH listens on'),
  (22, 2, '0x16 in hex'),

  (23, 1, '0x17 in hex'),
  (23, 2, 'A human cell carries 46 chromosomes, so this is half of them'),

  (24, 1, '24 hours in a day'),
  (24, 2, '24 frames per second: the film standard'),

  (25, 1, '25 Mbps is plenty for a 1080p stream'),
  (25, 2, '0x19 in hex'),

  (26, 1, '0x1A in hex - the ASCII SUB control character'),
  (26, 2, 'The element with atomic number 26 is iron, and ASCII 94 spells ^'),

  (27, 1, '3 cubed'),
  (27, 2, '0x1B in hex - ASCII ESC, the ancestor of the escape key'),

  (28, 1, 'February has this many days in a leap year'),
  (28, 2, '0x1C in hex'),

  (29, 1, 'A lunar month is about 29.5 days'),
  (29, 2, '0x1D in hex'),

  (30, 1, 'Seconds in half a minute, and 30 days in a month'),
  (30, 2, '0x1E in hex'),

  (31, 1, 'Days in January, March, May, July, August, October and December'),
  (31, 2, '2^5 - 1, the max value of five bits'),

  (32, 1, '32-bit architecture'),
  (32, 2, '0x20 in hex - the ASCII space character'),

  (33, 1, 'The atomic number of arsenic'),
  (33, 2, '0x21 in hex'),

  (34, 1, '0x22 in hex - the ASCII double-quote'),
  (34, 2, 'The element with atomic number 34 is selenium'),

  (35, 1, '0x23 in hex - the ASCII number sign'),
  (35, 2, 'The element with atomic number 35 is bromine, the photographer''s favourite liquid'),

  (36, 1, '36 inches in a yard'),
  (36, 2, '0x24 in hex'),

  (37, 1, '0x25 in hex - the ASCII percent sign'),
  (37, 2, 'The atomic number of rubidium'),

  (38, 1, '0x26 in hex - the ASCII ampersand'),
  (38, 2, 'The atomic number of strontium'),

  (39, 1, '0x27 in hex - the ASCII apostrophe'),
  (39, 2, 'The atomic number of yttrium'),

  (40, 1, '8 bits plus a 32-bit word adds up to this'),
  (40, 2, '0x28 in hex - the ASCII left bracket'),

  (41, 1, '0x29 in hex - the ASCII right parenthesis'),
  (41, 2, 'The atomic number of niobium'),

  (42, 1, 'The Answer to Life, the Universe, and Everything'),
  (42, 2, '0x2A in hex - the ASCII asterisk'),

  (43, 1, '0x2B in hex - the ASCII plus sign'),
  (43, 2, 'The atomic number of technetium, the first synthetic element'),

  (44, 1, '0x2C in hex - the ASCII comma'),
  (44, 2, 'The atomic number of ruthenium'),

  (45, 1, '0x2D in hex - the ASCII hyphen'),
  (45, 2, 'The atomic number of rhodium'),

  (46, 1, 'A human cell carries 46 chromosomes'),
  (46, 2, '0x2E in hex - the ASCII full stop'),

  (47, 1, 'The atomic number of silver'),
  (47, 2, '0x2F in hex - the ASCII slash, the path separator'),

  (48, 1, '48 kHz: the CD-quality audio sampling rate'),
  (48, 2, '0x30 in hex - the ASCII character 0'),

  (49, 1, '7 squared'),
  (49, 2, '0x31 in hex - the ASCII character 1'),

  (50, 1, '502 Bad Gateway, so this is 50'),
  (50, 2, 'Half a century, and 0x32 in hex'),

  (51, 1, 'The atomic number of antimony'),
  (51, 2, '0x33 in hex - the ASCII character 3'),

  (52, 1, 'A full deck of playing cards'),
  (52, 2, '0x34 in hex - the ASCII character 4'),

  (53, 1, 'The atomic number of iodine, the one in your 128GB SD card'),
  (53, 2, '0x35 in hex - the ASCII character 5'),

  (54, 1, '6 x 9 - a rectangle of ticket cells'),
  (54, 2, '0x36 in hex - the ASCII character 6'),

  (55, 1, 'The atomic number of caesium, the atom that defines the second'),
  (55, 2, '0x37 in hex - the ASCII character 7'),

  (56, 1, '56k - the dial-up modem speed of our childhood'),
  (56, 2, '0x38 in hex - the ASCII character 8'),

  (57, 1, '0x39 in hex - the ASCII character 9'),
  (57, 2, 'The atomic number of lanthanum'),

  (58, 1, '0x3A in hex - the ASCII colon'),
  (58, 2, 'The atomic number of cerium'),

  (59, 1, '0x3B in hex - the ASCII semicolon'),
  (59, 2, 'The atomic number of praseodymium'),

  (60, 1, 'Seconds in a minute, and minutes in an hour'),
  (60, 2, '0x3C in hex - the ASCII less-than sign'),

  (61, 1, '0x3D in hex - the ASCII equals sign'),
  (61, 2, 'The atomic number of promethium'),

  (62, 1, '0x3E in hex - the ASCII greater-than sign'),
  (62, 2, 'The atomic number of samarium'),

  (63, 1, '2^6 - 1, the largest value six bits can hold'),
  (63, 2, '0x3F in hex - the ASCII question mark'),

  (64, 1, '64-bit architecture'),
  (64, 2, '8 x 8 is a chessboard, and IPv6 hands out /64 subnets'),

  (65, 1, '0x41 in hex - the ASCII capital A'),
  (65, 2, 'The atomic number of terbium'),

  (66, 1, '0x42 in hex - the ASCII capital B'),
  (66, 2, 'The atomic number of dysprosium'),

  (67, 1, '0x43 in hex - the ASCII capital C'),
  (67, 2, 'The atomic number of holmium'),

  (68, 1, '0x44 in hex - the ASCII capital D'),
  (68, 2, 'The atomic number of erbium'),

  (69, 1, '0x45 in hex - the ASCII capital E'),
  (69, 2, 'The atomic number of thulium'),

  (70, 1, '1970, the year the Unix epoch began'),
  (70, 2, '0x46 in hex - the ASCII capital F'),

  (71, 1, '0x47 in hex - the ASCII capital G'),
  (71, 2, 'The atomic number of lutetium, the last lanthanide'),

  (72, 1, '72 dpi: the classic screen resolution'),
  (72, 2, '0x48 in hex - the ASCII capital H'),

  (73, 1, '0x49 in hex - the ASCII capital I'),
  (73, 2, 'The atomic number of tantalum'),

  (74, 1, '0x4A in hex - the ASCII capital J'),
  (74, 2, 'The atomic number of tungsten, symbol W'),

  (75, 1, 'Three quarters of a hundred'),
  (75, 2, '0x4B in hex - the ASCII capital K'),

  (76, 1, '0x4C in hex - the ASCII capital L'),
  (76, 2, 'The atomic number of osmium, the densest element'),

  (77, 1, '0x4D in hex - the ASCII capital M'),
  (77, 2, 'The atomic number of iridium'),

  (78, 1, '0x4E in hex - the ASCII capital N'),
  (78, 2, 'The atomic number of platinum'),

  (79, 1, '0x4F in hex - the ASCII capital O'),
  (79, 2, 'The atomic number of gold, symbol Au'),

  (80, 1, '80 columns: the width of a classic terminal, 80 x 24'),
  (80, 2, '0x50 in hex - the ASCII capital P'),

  (81, 1, '3 to the fourth, and 9 x 9 is a Sudoku box'),
  (81, 2, '0x51 in hex - the ASCII capital Q'),

  (82, 1, '0x52 in hex - the ASCII capital R'),
  (82, 2, 'The atomic number of lead, symbol Pb'),

  (83, 1, '0x53 in hex - the ASCII capital S'),
  (83, 2, 'The atomic number of bismuth'),

  (84, 1, '0x54 in hex - the ASCII capital T'),
  (84, 2, 'The atomic number of polonium'),

  (85, 1, '0x55 in hex - the ASCII capital U'),
  (85, 2, 'The atomic number of astatine'),

  (86, 1, '0x56 in hex - the ASCII capital V'),
  (86, 2, 'The atomic number of radon'),

  (87, 1, '0x57 in hex - the ASCII capital W'),
  (87, 2, 'The atomic number of francium, the least stable of all'),

  (88, 1, '8088 - the Intel 8-bit processor, so this is 88'),
  (88, 2, 'The atomic number of radium'),

  (89, 1, '0x59 in hex - the ASCII capital Y'),
  (89, 2, 'The atomic number of actinium'),

  (90, 1, '90: the traditional upper bound of a tambola ticket'),
  (90, 2, '0x5A in hex - the ASCII capital Z')
ON CONFLICT (number, variant) DO UPDATE SET text = EXCLUDED.text;

-- Sanity check: all 90 numbers must be present with 2 variants each.
DO $$
DECLARE
  v_missing INTEGER;
  v_banks   INTEGER;
BEGIN
  SELECT count(*) INTO v_banks FROM public.tambola_clue_bank;
  SELECT count(*) INTO v_missing
    FROM generate_series(1, 90) AS n
   WHERE (SELECT count(*) FROM public.tambola_clue_bank b WHERE b.number = n) < 2;

  IF v_banks < 180 OR v_missing > 0 THEN
    RAISE EXCEPTION 'Clue bank incomplete: % rows, % numbers with fewer than 2 variants',
      v_banks, v_missing;
  END IF;
END;
$$;
