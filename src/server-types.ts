import type { SupportedSchema } from "./subset.js";

/** Everything the browser page needs to render and submit one form. */
export interface FormPayload {
  title: string;
  description?: string;
  schema: SupportedSchema;
  /** Random secret guarding this form's endpoints. */
  token: string;
  /** Port the form's HTTP server listens on (127.0.0.1). */
  port: number;
}
