type IsAny<T> = 0 extends 1 & T ? true : false;

type IsNever<T> = [T] extends [never] ? true : false;

/**
 * Accepts non-empty, string-keyed object event maps while preserving the
 * original event-map type for inference.
 */
export type ValidEventMap<TEvents> =
  IsAny<TEvents> extends true
    ? never
    : IsNever<TEvents> extends true
      ? never
      : [TEvents] extends [object]
        ? [TEvents] extends [readonly unknown[]]
          ? never
          : [keyof TEvents] extends [never]
            ? never
            : [keyof TEvents] extends [string]
              ? TEvents
              : never
        : never;
