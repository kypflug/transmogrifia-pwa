/** Minimal recipe info for display purposes (no AI prompts needed) */
export interface RecipeInfo {
  id: string;
  name: string;
  icon: string;
}

export const RECIPES: RecipeInfo[] = [
  { id: 'focus',       name: 'Focus',       icon: '🎯' },
  { id: 'reader',      name: 'Reader',      icon: '📖' },
  { id: 'aesthetic',   name: 'Aesthetic',    icon: '🎨' },
  { id: 'illustrated', name: 'Illustrated', icon: '🖼️' },
  { id: 'visualize',   name: 'Visualize',   icon: '📊' },
  { id: 'declutter',   name: 'Declutter',   icon: '✂️' },
  { id: 'interview',   name: 'Interview',   icon: '🎙️' },
  { id: 'custom',      name: 'Custom',      icon: '⚗️' },
];

export function getRecipe(id: string): RecipeInfo | undefined {
  return RECIPES.find(r => r.id === id);
}
