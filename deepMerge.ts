interface MergeOptions {
  /**
   * Whether to merge arrays instead of overwriting them.
   * @default true
   */
  mergeArrays?: boolean
}

type MergeableRecord = Record<string, unknown>

function isMergeableObject(value: unknown): value is MergeableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deeply merges two objects, handling nested objects and arrays.
 * @param target The target object to merge into.
 * @param source The source object to merge from.
 * @param options Merge options.
 * @returns The merged object.
 */
function deepMerge<T extends object, S extends object>(
  target: T,
  source: S,
  options: MergeOptions = { mergeArrays: true }
): T & S {
  const result: MergeableRecord = { ...(target as MergeableRecord) }

  for (const key of Object.keys(source) as Array<keyof S & string>) {
    const sourceValue = (source as MergeableRecord)[key]
    const targetValue = result[key]

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      result[key] = options.mergeArrays ? [...targetValue, ...sourceValue] : sourceValue
      continue
    }

    if (isMergeableObject(targetValue) && isMergeableObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue, options)
      continue
    }

    result[key] = sourceValue
  }

  return result as T & S
}

export default deepMerge
