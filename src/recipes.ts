/** Minimal recipe info for display purposes (no AI prompts needed) */
export interface RecipeInfo {
  id: string;
  name: string;
  icon: string;
  /** Legacy recipes are kept for display on older remixes but hidden from pickers */
  legacy?: boolean;
}

export const RECIPES: RecipeInfo[] = [
  { id: 'focus',       name: 'Focus',       icon: '🎯', legacy: true },
  { id: 'reader',      name: 'Reader',      icon: '📖' },
  { id: 'aesthetic',   name: 'Aesthetic',    icon: '🎨' },
  { id: 'illustrated', name: 'Illustrated', icon: '🖼️' },
  { id: 'visualize',   name: 'Visualize',   icon: '📊' },
  { id: 'declutter',   name: 'Declutter',   icon: '✂️', legacy: true },
  { id: 'interview',   name: 'Interview',   icon: '🎙️' },
  { id: 'custom',      name: 'Custom',      icon: '⚗️' },
];

/** Recipes available for new transmogrifications (excludes legacy) */
export const PICKER_RECIPES: RecipeInfo[] = RECIPES.filter(r => !r.legacy);

export function getRecipe(id: string): RecipeInfo | undefined {
  return RECIPES.find(r => r.id === id);
}
