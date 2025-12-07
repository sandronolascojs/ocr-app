const adjectives = [
  'Swift',
  'Bright',
  'Noble',
  'Brave',
  'Clever',
  'Daring',
  'Elegant',
  'Fierce',
  'Gentle',
  'Honest',
  'Jolly',
  'Kind',
  'Lively',
  'Mighty',
  'Nimble',
  'Proud',
  'Quick',
  'Radiant',
  'Stellar',
  'Vivid',
];

const nouns = [
  'Eagle',
  'Falcon',
  'Phoenix',
  'Dragon',
  'Lion',
  'Tiger',
  'Wolf',
  'Bear',
  'Hawk',
  'Raven',
  'Storm',
  'Thunder',
  'Lightning',
  'Star',
  'Comet',
  'Nova',
  'Aurora',
  'Cosmos',
  'Nebula',
  'Galaxy',
];

export const generateRandomTeamName = (): string => {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective} ${noun}`;
};

