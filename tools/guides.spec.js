// Watch guides + featured film series — the source for src/guides/guides.json.
// Edit this file, then run:  node tools/build-guides.js
//
// guides[].films: [key, English title, release year] — resolved to TMDB ids by the script.
// guides[].chrono: the story-order, as a list of keys (optional). Release order is
// always computed from the release dates. Films that aren't out yet are left out
// automatically, so a guide can list announced titles.
// collections: TMDB collection ids shown in the "Filmové série" row.

module.exports = {
  guides: [
    {
      id: 'mcu',
      title: 'Marvel Cinematic Universe',
      subtitle: 'Filmy MCU podle vydání nebo podle děje',
      note: 'Chronologické pořadí podle oficiální časové osy do Avengers: Endgame; novější filmy navazují v pořadí vydání.',
      films: [
        ['iron-man', 'Iron Man', 2008],
        ['incredible-hulk', 'The Incredible Hulk', 2008],
        ['iron-man-2', 'Iron Man 2', 2010],
        ['thor', 'Thor', 2011],
        ['first-avenger', 'Captain America: The First Avenger', 2011],
        ['avengers', 'The Avengers', 2012],
        ['iron-man-3', 'Iron Man 3', 2013],
        ['thor-dark-world', 'Thor: The Dark World', 2013],
        ['winter-soldier', 'Captain America: The Winter Soldier', 2014],
        ['gotg', 'Guardians of the Galaxy', 2014],
        ['age-of-ultron', 'Avengers: Age of Ultron', 2015],
        ['ant-man', 'Ant-Man', 2015],
        ['civil-war', 'Captain America: Civil War', 2016],
        ['doctor-strange', 'Doctor Strange', 2016],
        ['gotg-2', 'Guardians of the Galaxy Vol. 2', 2017],
        ['homecoming', 'Spider-Man: Homecoming', 2017],
        ['ragnarok', 'Thor: Ragnarok', 2017],
        ['black-panther', 'Black Panther', 2018],
        ['infinity-war', 'Avengers: Infinity War', 2018],
        ['ant-man-wasp', 'Ant-Man and the Wasp', 2018],
        ['captain-marvel', 'Captain Marvel', 2019],
        ['endgame', 'Avengers: Endgame', 2019],
        ['far-from-home', 'Spider-Man: Far From Home', 2019],
        ['black-widow', 'Black Widow', 2021],
        ['shang-chi', 'Shang-Chi and the Legend of the Ten Rings', 2021],
        ['eternals', 'Eternals', 2021],
        ['no-way-home', 'Spider-Man: No Way Home', 2021],
        ['multiverse-of-madness', 'Doctor Strange in the Multiverse of Madness', 2022],
        ['love-and-thunder', 'Thor: Love and Thunder', 2022],
        ['wakanda-forever', 'Black Panther: Wakanda Forever', 2022],
        ['quantumania', 'Ant-Man and the Wasp: Quantumania', 2023],
        ['gotg-3', 'Guardians of the Galaxy Vol. 3', 2023],
        ['the-marvels', 'The Marvels', 2023],
        ['deadpool-wolverine', 'Deadpool & Wolverine', 2024],
        ['brave-new-world', 'Captain America: Brave New World', 2025],
        ['thunderbolts', 'Thunderbolts*', 2025],
        ['fantastic-four', 'The Fantastic Four: First Steps', 2025],
        ['brand-new-day', 'Spider-Man: Brand New Day', 2026],
        ['doomsday', 'Avengers: Doomsday', 2026]
      ],
      chrono: [
        'first-avenger', 'captain-marvel', 'iron-man', 'iron-man-2', 'incredible-hulk', 'thor', 'avengers',
        'iron-man-3', 'thor-dark-world', 'winter-soldier', 'gotg', 'gotg-2', 'age-of-ultron', 'ant-man',
        'civil-war', 'black-widow', 'black-panther', 'homecoming', 'doctor-strange', 'ragnarok', 'ant-man-wasp',
        'infinity-war', 'endgame',
        // after Endgame: release order
        'far-from-home', 'shang-chi', 'eternals', 'no-way-home', 'multiverse-of-madness', 'love-and-thunder',
        'wakanda-forever', 'quantumania', 'gotg-3', 'the-marvels', 'deadpool-wolverine', 'brave-new-world',
        'thunderbolts', 'fantastic-four', 'brand-new-day', 'doomsday'
      ]
    },
    {
      id: 'star-wars',
      title: 'Star Wars',
      subtitle: 'Sága Skywalkerů a samostatné příběhy',
      films: [
        ['iv', 'Star Wars', 1977],
        ['v', 'The Empire Strikes Back', 1980],
        ['vi', 'Return of the Jedi', 1983],
        ['i', 'Star Wars: Episode I - The Phantom Menace', 1999],
        ['ii', 'Star Wars: Episode II - Attack of the Clones', 2002],
        ['iii', 'Star Wars: Episode III - Revenge of the Sith', 2005],
        ['vii', 'Star Wars: The Force Awakens', 2015],
        ['rogue-one', 'Rogue One: A Star Wars Story', 2016],
        ['viii', 'Star Wars: The Last Jedi', 2017],
        ['solo', 'Solo: A Star Wars Story', 2018],
        ['ix', 'Star Wars: The Rise of Skywalker', 2019],
        ['mandalorian-grogu', 'The Mandalorian and Grogu', 2026]
      ],
      chrono: ['i', 'ii', 'iii', 'solo', 'rogue-one', 'iv', 'v', 'vi', 'mandalorian-grogu', 'vii', 'viii', 'ix']
    },
    {
      id: 'wizarding-world',
      title: 'Kouzelnický svět',
      subtitle: 'Harry Potter a Fantastická zvířata',
      films: [
        ['hp1', "Harry Potter and the Philosopher's Stone", 2001],
        ['hp2', 'Harry Potter and the Chamber of Secrets', 2002],
        ['hp3', 'Harry Potter and the Prisoner of Azkaban', 2004],
        ['hp4', 'Harry Potter and the Goblet of Fire', 2005],
        ['hp5', 'Harry Potter and the Order of the Phoenix', 2007],
        ['hp6', 'Harry Potter and the Half-Blood Prince', 2009],
        ['hp7', 'Harry Potter and the Deathly Hallows: Part 1', 2010],
        ['hp8', 'Harry Potter and the Deathly Hallows: Part 2', 2011],
        ['fb1', 'Fantastic Beasts and Where to Find Them', 2016],
        ['fb2', 'Fantastic Beasts: The Crimes of Grindelwald', 2018],
        ['fb3', 'Fantastic Beasts: The Secrets of Dumbledore', 2022]
      ],
      chrono: ['fb1', 'fb2', 'fb3', 'hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'hp6', 'hp7', 'hp8']
    },
    {
      id: 'fast-furious',
      title: 'Rychle a zběsile',
      subtitle: 'Včetně správného místa pro Tokijskou jízdu',
      films: [
        ['f1', 'The Fast and the Furious', 2001],
        ['f2', '2 Fast 2 Furious', 2003],
        ['tokyo', 'The Fast and the Furious: Tokyo Drift', 2006],
        ['f4', 'Fast & Furious', 2009],
        ['f5', 'Fast Five', 2011],
        ['f6', 'Fast & Furious 6', 2013],
        ['f7', 'Furious 7', 2015],
        ['f8', 'The Fate of the Furious', 2017],
        ['hobbs-shaw', 'Fast & Furious Presents: Hobbs & Shaw', 2019],
        ['f9', 'F9', 2021],
        ['fx', 'Fast X', 2023]
      ],
      chrono: ['f1', 'f2', 'f4', 'f5', 'f6', 'tokyo', 'f7', 'f8', 'hobbs-shaw', 'f9', 'fx']
    },
    {
      id: 'alien',
      title: 'Vetřelec',
      subtitle: 'Od Promethea po Romulus',
      films: [
        ['alien', 'Alien', 1979],
        ['aliens', 'Aliens', 1986],
        ['alien3', 'Alien³', 1992],
        ['resurrection', 'Alien Resurrection', 1997],
        ['prometheus', 'Prometheus', 2012],
        ['covenant', 'Alien: Covenant', 2017],
        ['romulus', 'Alien: Romulus', 2024]
      ],
      chrono: ['prometheus', 'covenant', 'alien', 'romulus', 'aliens', 'alien3', 'resurrection']
    }
  ],

  // TMDB collections for the "Filmové série" row (names/parts come from TMDB).
  collections: [
    1241,    // Harry Potter
    119,     // The Lord of the Rings
    121938,  // The Hobbit
    10,      // Star Wars
    404609,  // John Wick
    10194,   // Toy Story
    295,     // Pirates of the Caribbean
    328,     // Jurassic Park
    87359,   // Mission: Impossible
    264,     // Back to the Future
    2344,    // The Matrix
    263,     // The Dark Knight
    84,      // Indiana Jones
    2150,    // Shrek
    86066,   // Despicable Me
    131635,  // The Hunger Games
    528,     // The Terminator
    87096,   // Avatar
    77816,   // Kung Fu Panda
    31562,   // Jason Bourne
    230,     // The Godfather
    726871,  // Dune
    89137,   // How to Train Your Dragon
    1575,    // Rocky
    1570     // Die Hard
  ]
};
