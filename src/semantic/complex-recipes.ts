export type ComplexRecipeFamily =
  | 'data-driven'
  | 'form'
  | 'overlay'
  | 'date-range';

export type ComplexComponentRecipe = {
  family: ComplexRecipeFamily;
  /**
   * Optional runtime-capable targets that form the component's useful minimum
   * usage. Required runtime targets are always included independently.
   */
  runtimeTargets: readonly string[];
  summary: string;
};

/**
 * Component-specific defaults stay as data so complex APIs do not introduce
 * JSX branches into the resolver.
 */
export const COMPLEX_COMPONENT_RECIPES: Readonly<
Record<string, ComplexComponentRecipe>
> = {
  TashilDropdown: {
    family: 'data-driven',
    runtimeTargets: ['options', 'value', 'onChange'],
    summary: 'Figma supplies appearance; application code supplies options, value, and onChange.',
  },
};

export function getComplexComponentRecipe(
  componentName: string,
): ComplexComponentRecipe | undefined {
  return COMPLEX_COMPONENT_RECIPES[componentName];
}

