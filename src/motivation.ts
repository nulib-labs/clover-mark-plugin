export type AnnotationMotivation = string | string[] | undefined;

export function hasAnnotationMotivation(motivation: AnnotationMotivation): boolean {
  if (Array.isArray(motivation)) {
    return motivation.some((value) => typeof value === "string" && value.trim().length > 0);
  }

  return typeof motivation === "string" && motivation.trim().length > 0;
}

export function applyDefaultMotivation<
  T extends Record<string, unknown> & { motivation?: string | string[] },
>(
  annotation: T,
  defaultMotivation?: string | string[],
): T {
  if (hasAnnotationMotivation(annotation.motivation) || defaultMotivation === undefined) {
    return annotation;
  }

  return {
    ...annotation,
    motivation: defaultMotivation,
  };
}

export function getPrimaryMotivation(motivation: AnnotationMotivation): string | undefined {
  if (Array.isArray(motivation)) {
    const first = motivation.find(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    return typeof first === "string" ? first.trim() : undefined;
  }

  if (typeof motivation === "string" && motivation.trim().length > 0) {
    return motivation.trim();
  }

  return undefined;
}
