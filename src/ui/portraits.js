// Caller portraits for each emotional state. Built-in callers use DiceBear "Avataaars"
// (Pablo Stanley's illustrations, free for personal & commercial use) with
// emotion-specific eyes/eyebrows/mouth. Custom clients can upload a picture per emotion.
import { createAvatar } from '@dicebear/core';
import * as avataaars from '@dicebear/avataaars';

const FACES = {
  neutral: { eyes: 'default', eyebrows: 'defaultNatural', mouth: 'default' },
  happy: { eyes: 'happy', eyebrows: 'raisedExcitedNatural', mouth: 'smile' },
  excited: { eyes: 'hearts', eyebrows: 'raisedExcited', mouth: 'twinkle' },
  confused: { eyes: 'squint', eyebrows: 'upDownNatural', mouth: 'disbelief' },
  suspicious: { eyes: 'side', eyebrows: 'flatNatural', mouth: 'serious' },
  angry: { eyes: 'squint', eyebrows: 'angryNatural', mouth: 'screamOpen' },
  scared: { eyes: 'surprised', eyebrows: 'sadConcernedNatural', mouth: 'grimace' },
  sad: { eyes: 'cry', eyebrows: 'sadConcernedNatural', mouth: 'sad' },
};
export const PORTRAIT_EMOTIONS = Object.keys(FACES);

const cache = new Map();

function arr(v) {
  return v ? [String(v)] : undefined;
}

export function avatarDataUri(avatar = {}, emotion = 'neutral') {
  const key = JSON.stringify([avatar, emotion]);
  if (cache.has(key)) return cache.get(key);
  const face = FACES[emotion] || FACES.neutral;
  const opts = {
    seed: avatar.seed || 'caller',
    radius: 12,
    backgroundColor: arr(avatar.backgroundColor) || ['b6e3f4'],
    top: arr(avatar.top),
    hairColor: arr(avatar.hairColor),
    hatColor: arr(avatar.hatColor),
    skinColor: arr(avatar.skinColor),
    clothing: arr(avatar.clothing),
    clothesColor: arr(avatar.clothesColor),
    clothingGraphic: arr(avatar.clothingGraphic),
    accessories: arr(avatar.accessories),
    accessoriesProbability: avatar.accessories ? 100 : 0,
    facialHair: arr(avatar.facialHair),
    facialHairColor: arr(avatar.facialHairColor || avatar.hairColor),
    facialHairProbability: avatar.facialHair ? 100 : 0,
    eyes: [face.eyes],
    eyebrows: [face.eyebrows],
    mouth: [face.mouth],
  };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  let uri;
  try {
    uri = createAvatar(avataaars, opts).toDataUri();
  } catch (err) {
    console.warn('avatar failed', err);
    uri = createAvatar(avataaars, { seed: avatar.seed || 'x', eyes: [face.eyes], eyebrows: [face.eyebrows], mouth: [face.mouth] }).toDataUri();
  }
  cache.set(key, uri);
  return uri;
}

/** Portrait for a caller definition in a given emotion. */
export function portraitFor(caller, emotion = 'neutral') {
  const imgs = caller?.appearance?.images;
  if (imgs) {
    const img = imgs[emotion] || imgs.neutral || Object.values(imgs).find(Boolean);
    if (img) return img;
  }
  return avatarDataUri(caller?.appearance?.avatar || { seed: caller?.id || 'x' }, emotion);
}

export const AVATAR_OPTIONS = {
  top: ['bob', 'bun', 'curly', 'curvy', 'longButNotTooLong', 'miaWallace', 'straight01', 'straight02', 'straightAndStrand', 'bigHair', 'frida', 'fro', 'froBand', 'dreads', 'shortFlat', 'shortRound', 'shortWaved', 'sides', 'theCaesar', 'theCaesarAndSidePart', 'shortCurly', 'shaggy', 'shaggyMullet', 'dreads01', 'dreads02', 'frizzle', 'shavedSides', 'hat', 'hijab', 'turban', 'winterHat1', 'winterHat02'],
  hairColor: ['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'd6b370', 'c93305', 'f59797', 'ecdcbf', 'e8e1e1'],
  skinColor: ['614335', 'd08b5b', 'ae5d29', 'edb98a', 'ffdbb4', 'fd9841', 'f8d25c'],
  facialHair: ['', 'beardLight', 'beardMajestic', 'beardMedium', 'moustacheFancy', 'moustacheMagnum'],
  accessories: ['', 'kurt', 'prescription01', 'prescription02', 'round', 'sunglasses', 'wayfarers', 'eyepatch'],
  clothing: ['blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'overall', 'shirtCrewNeck', 'shirtScoopNeck', 'shirtVNeck'],
  clothesColor: ['262e33', '65c9ff', '5199e4', '25557c', 'e6e6e6', '929598', '3c4f5c', 'b1e2ff', 'a7ffc4', 'ffafb9', 'ffffb1', 'ff488e', 'ff5c5c', 'ffffff'],
  backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c1f4c5', 'fff3b0'],
};
