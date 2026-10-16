// Thin front door to the model makers: people (character.js) and vehicles (vehicles.js).
import { makeCharacter, randomOutfit, poseCharacter } from './character.js';
import { makeMoto, paintMoto, makeTrafficVehicle } from './vehicles.js';

// A person with a random outfit. opts: { vest: number, helmet: colour|true, shirt: colour, outfit }
export function makePerson(r = Math.random, opts = {}) {
  return makeCharacter(opts.outfit || randomOutfit(r, opts));
}
export const pose = poseCharacter;

export function makeBike(color = 0xc81e1e, kind = 'wave') {
  return makeMoto(kind, { paint: typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color });
}
export const setBikeColor = paintMoto;
export const makeVehicle = makeTrafficVehicle;
