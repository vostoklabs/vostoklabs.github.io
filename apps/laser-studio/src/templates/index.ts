// The registry the gallery is drawn from. One line per design; the design is its own file.
import { nameKeychain } from './name-keychain';
import { nameTag } from './name-tag';
import { symbolCharm } from './symbol-charm';
import { connectedText } from './connected-text';
import { petIdTag } from './pet-id-tag';
import { petFeedingSign } from './pet-feeding-sign';
import { luggageTag } from './luggage-tag';
import { bagCharm } from './bag-charm';
import { christmasOrnament } from './christmas-ornament';
import { familyCrossword } from './family-crossword';
import { tileKeychain } from './tile-keychain';
import { layeredKeychain } from './layered-keychain';
import { familyTreeNames } from './family-tree-names';
import { namePuzzle } from './name-puzzle';
import { splitMonogram } from './split-monogram';
import { arcCoaster } from './arc-coaster';
import { svgKeychain } from './svg-keychain';
import { placeCards } from './place-cards';
import { hairTieHolder } from './hair-tie-holder';
import { hairTieCard } from './hair-tie-card';
import { framedNameOrnament } from './framed-name-ornament';
import { houseOrnament } from './house-ornament';
import { themedFaceOrnament } from './themed-face-ornament';
import { basketballTag, baseballTag, footballTag, soccerTag } from './sports-tags';
import { qrStand } from './qr-stand';
import { qrDisplayStand } from './qr-display-stand';
import { qrSlotStand } from './qr-slot-stand';
import { qrTableTent } from './qr-table-tent';
import { qrTag } from './qr-tag';
import { cakeTopper } from './cake-topper';
import { businessCard } from './business-card';
import { ticTacToe } from './tic-tac-toe';
import { braceletSet } from './bracelet-set';
import { braceletSetSymbol } from './bracelet-set-symbol';
import { dateKeychain } from './date-keychain';
import { patternFill } from './pattern-fill';
import { patternSvg } from './pattern-svg';
import { coupleKeychains } from './couple-keychains';
import { phoneStand } from './phone-stand';
import { keychainPhoneStand } from './keychain-phone-stand';
import { tableSign } from './table-sign';
import type { TemplateDef } from './types';

export const TEMPLATES: TemplateDef[] = [
  qrDisplayStand, nameKeychain, nameTag, symbolCharm, connectedText,
  petIdTag, petFeedingSign, luggageTag, bagCharm, christmasOrnament,
  familyCrossword, tileKeychain, qrStand, qrSlotStand, qrTableTent, qrTag, cakeTopper, layeredKeychain, familyTreeNames, namePuzzle, splitMonogram, arcCoaster, svgKeychain, placeCards, hairTieHolder, hairTieCard, framedNameOrnament, houseOrnament, themedFaceOrnament, basketballTag, baseballTag, footballTag, soccerTag, businessCard, ticTacToe, braceletSet, braceletSetSymbol, dateKeychain, coupleKeychains, phoneStand, keychainPhoneStand, tableSign, patternFill, patternSvg,
];

export const templateById = (id: string): TemplateDef | undefined => TEMPLATES.find((t) => t.id === id);

export type { TemplateDef, Field, Values } from './types';
export { defaultsOf, coerceValues } from './types';
