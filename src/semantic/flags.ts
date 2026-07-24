/**
 * Local development feature flag for semantic connect authoring.
 *
 * Reading saved recipes (Dev Mode / Inspect generation) is always on; this
 * flag gates only the authoring UI while it stabilizes. Flip to `false` to
 * hide the Implementation mapping editor without affecting saved connections
 * (roadmap M6 §"Feature delivery").
 */
export const SEMANTIC_CONNECT_AUTHORING_ENABLED = true;
