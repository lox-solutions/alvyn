// ---------------------------------------------------------------------------
// CloudEvents v1.0.2 — Context Attributes
// ---------------------------------------------------------------------------

/**
 * CloudEvents v1.0.2 REQUIRED context attributes.
 *
 * Every stored event conforms to the CloudEvents specification.
 * Attribute names use lowercase per the spec naming convention.
 *
 * @see https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
 */
export interface CloudEventRequiredAttributes {
  /**
   * Identifies the event.
   * Unique within the scope of the producer (`source` + `id` is globally unique).
   * Format: `"{streamId}/{streamVersion}"` (e.g. `"Order-123/5"`).
   */
  id: string;

  /**
   * Identifies the context in which the event happened.
   * A URI-reference (e.g. `"urn:myapp:order-service"` or `"https://myapp.example.com"`).
   */
  source: string;

  /**
   * The version of the CloudEvents specification.
   * Always `"1.0"` for this library.
   */
  specversion: string;

  /**
   * Describes the type of event (e.g. `"OrderPlaced"`, `"UserRegistered"`).
   * Maps to the domain event type name.
   */
  type: string;
}

/**
 * CloudEvents v1.0.2 OPTIONAL context attributes.
 *
 * @see https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#optional-attributes
 */
export interface CloudEventOptionalAttributes {
  /**
   * Content type of the `data` value.
   * Defaults to `"application/json"` when data is present.
   */
  datacontenttype?: string;

  /**
   * URI identifying the schema that `data` adheres to.
   */
  dataschema?: string;

  /**
   * Describes the subject of the event in the context of the event producer.
   * In this library, defaults to the `streamId`.
   */
  subject?: string;

  /**
   * Timestamp of when the occurrence happened.
   * RFC 3339 format (e.g. `"2024-03-12T10:00:00.000Z"`).
   */
  time?: string;
}

/**
 * CloudEvents extension attributes.
 *
 * Per the spec, extension attribute names MUST consist of lowercase letters
 * or digits only. These are domain-specific attributes attached to events.
 */
export interface CloudEventExtensions {
  /** Unique ID for correlating a chain of events across services */
  correlationid?: string;
  /** ID of the event/command that caused this event */
  causationid?: string;
  /** ID of the user/system actor who triggered this event */
  actorid?: string;
  /**
   * Schema version for upcasting (default: 1).
   * This is an internal extension used by the event store for schema evolution.
   */
  schemaversion?: number;
  /** Additional arbitrary extension attributes (must be lowercase names) */
  [key: string]: unknown;
}

/**
 * Complete CloudEvents context (required + optional + extensions).
 * This represents the full set of context attributes for a stored event,
 * with extension attributes nested under `extensions` (matching how
 * `StoredEvent` structures them, NOT the flat JSON wire format).
 */
export type CloudEventContext = CloudEventRequiredAttributes &
  CloudEventOptionalAttributes & {
    extensions: CloudEventExtensions;
  };
