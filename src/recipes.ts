/** Minimal recipe info for display purposes (no AI prompts needed) */
export interface RecipeInfo {
  id: string;
  name: string;
  icon: string;
  requiresAI?: boolean;
  /** Legacy recipes are kept for display on older remixes but hidden from pickers */
  legacy?: boolean;
}

export const RECIPES: RecipeInfo[] = [
  { id: 'fast', name: 'Fast', icon: '⚡', requiresAI: true },
  { id: 'focus',       name: 'Focus',       icon: '🎯', legacy: true },
  { id: 'reader',      name: 'Reader',      icon: '📖', requiresAI: true },
  { id: 'aesthetic',   name: 'Aesthetic',   icon: '🎨', requiresAI: true },
  { id: 'illustrated', name: 'Illustrated', icon: '🖼️', requiresAI: true },
  { id: 'visualize',   name: 'Visualize',   icon: '📊', requiresAI: true },
  { id: 'declutter',   name: 'Declutter',   icon: '✂️', legacy: true },
  { id: 'interview',   name: 'Interview',   icon: '🎙️', requiresAI: true },
  { id: 'custom',      name: 'Custom',      icon: '⚗️', requiresAI: true },
];

/** Recipes available for new transmogrifications (excludes legacy) */
export const PICKER_RECIPES: RecipeInfo[] = RECIPES.filter(r => !r.legacy);

export function getRecipe(id: string): RecipeInfo | undefined {
  const normalized = id === 'fast-no-inference' ? 'fast' : id;
  return RECIPES.find(r => r.id === normalized);
}

export function getDefaultRecipeId(): string {
  return PICKER_RECIPES.some(recipe => recipe.id === 'fast')
    ? 'fast'
    : 'reader';
}

export function recipeRequiresAI(recipeId: string): boolean {
  return getRecipe(recipeId)?.requiresAI !== false;
}

