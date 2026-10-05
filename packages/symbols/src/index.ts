// The symbol library: Material Symbols, Tabler Icons (filled) and Fluent Emoji (High Contrast)
// under one id scheme, one set of categories and one search, and every symbol as a drawing and
// as closed shapes in millimetres. The picker over it is the kit's `openSymbolChooser`.
export {
  SYMBOL_SETS,
  SYMBOL_CATEGORIES,
  symbolById,
  resolveSymbolId,
  listSymbols,
  searchSymbols,
  type SymbolSetId,
  type SymbolSet,
  type SymbolEntry,
  type SymbolFilter,
} from './library';
export { symbolShapes, symbolPath } from './shapes';
export { isSolidShape } from './solid';
export { outlinePath, type Ring, type Shapes } from './outline';
export { FONT_AWESOME_TWINS, fontAwesomeTwin, LUCIDE_TWINS, lucideTwin } from './legacy';
