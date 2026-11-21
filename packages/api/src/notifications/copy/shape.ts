/** Same keys as T, every leaf a string (api-local twin of the web runtime's `Shape<>`). */
export type CopyShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : CopyShape<T[K]> };
