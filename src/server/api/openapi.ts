import { WEBHOOK_EVENTS } from "../webhooks";

const err = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const page = [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "per_page", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }];
const id = (name = "id") => ({ name, in: "path", required: true, schema: { type: "string" } });
const ok = (schema: string, description = "OK") => ({ description, content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } });

/** Machine-readable description of the public API, served at /api/v1/openapi.json. */
export function openApiDocument(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: { title: "KudoBird API", version: "1.0.0", description: "Org-scoped REST API. Create an API key under Developers and send it as `Authorization: Bearer <key>`. Scopes: `read`, `write` (create entries, revoke), `pii` (include mobile and email in responses). Limit: 300 requests per minute per key." },
    servers: [{ url: baseUrl }],
    security: [{ bearer: [] }],
    paths: {
      "/api/v1/campaigns": { get: { summary: "List campaigns", parameters: page, responses: { 200: ok("CampaignList"), 401: err, 429: err } } },
      "/api/v1/campaigns/{id}": { get: { summary: "Get a campaign", parameters: [id()], responses: { 200: ok("CampaignResponse"), 404: err } } },
      "/api/v1/campaigns/{id}/entries": {
        get: { summary: "List entries", description: "Contact details are included only for keys with the `pii` scope.", parameters: [id(), ...page, { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected"] } }, { name: "q", in: "query", schema: { type: "string" } }], responses: { 200: ok("EntryList"), 404: err } },
        post: { summary: "Create an entry and issue its certificate", description: "Follows the campaign's duplicate policy and approval mode. Requires `write`. The certificate images are rendered asynchronously: poll `GET /certificates/{id}` until `render_status` is `ready`, or use the `certificate.issued` webhook.", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateEntry" } } } }, responses: { 201: ok("CreatedEntry", "Created"), 200: ok("CreatedEntry", "Existing entry returned (duplicate policy: return_existing)"), 403: err, 404: err, 409: err, 422: err } },
      },
      "/api/v1/campaigns/{id}/certificates": { get: { summary: "List certificates of a campaign", parameters: [id(), ...page], responses: { 200: ok("CertificateList"), 404: err } } },
      "/api/v1/certificates/{id}": { get: { summary: "Get a certificate (by public id or number)", parameters: [id()], responses: { 200: ok("CertificateResponse"), 404: err } } },
      "/api/v1/certificates/{id}/revoke": { post: { summary: "Revoke a certificate", requestBody: { content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string", maxLength: 300 } } } } } }, parameters: [id()], responses: { 200: ok("CertificateResponse"), 404: err } } },
      "/api/v1/usage": { get: { summary: "Plan, limits and current usage", responses: { 200: { description: "OK" } } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "kb_<prefix>_<secret>" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "object", additionalProperties: { type: "string" } }, request_id: { type: "string" } } } } },
        Pagination: { type: "object", properties: { page: { type: "integer" }, per_page: { type: "integer" }, total: { type: "integer" }, total_pages: { type: "integer" } } },
        Campaign: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, status: { type: "string" }, language: { type: "string" }, certificate_number_prefix: { type: "string" }, form_url: { type: "string" }, approval_mode: { type: "boolean" }, duplicate_policy: { type: "string" }, custom_fields: { type: "array", items: { type: "object" } } } },
        CampaignList: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Campaign" } }, pagination: { $ref: "#/components/schemas/Pagination" } } },
        CampaignResponse: { type: "object", properties: { data: { $ref: "#/components/schemas/Campaign" } } },
        Certificate: { type: "object", properties: { id: { type: "string" }, number: { type: "string" }, status: { type: "string", enum: ["active", "revoked"] }, name: { type: "string" }, render_status: { type: "string", enum: ["processing", "ready", "failed"] }, url: { type: "string" }, images: { type: "object", additionalProperties: { type: "string" } }, issued_at: { type: "string", format: "date-time" } } },
        CertificateList: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Certificate" } }, pagination: { $ref: "#/components/schemas/Pagination" } } },
        CertificateResponse: { type: "object", properties: { data: { $ref: "#/components/schemas/Certificate" } } },
        EntryList: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, pagination: { $ref: "#/components/schemas/Pagination" } } },
        CreateEntry: { type: "object", required: ["name", "mobile", "consent"], properties: { name: { type: "string" }, mobile: { type: "string", description: "Validated for the campaign's country (default India: 10 digits)" }, email: { type: "string" }, custom_fields: { type: "object", additionalProperties: { type: "string" } }, language: { type: "string", enum: ["mr", "hi", "en"] }, wall_opt_in: { type: "boolean" }, consent: { type: "boolean", enum: [true], description: "Confirms the person agreed to their details being used" } } },
        CreatedEntry: { type: "object", properties: { data: { type: "object", properties: { entry: { type: "object" }, certificate: { $ref: "#/components/schemas/Certificate" } } } } },
      },
    },
    "x-webhooks": {
      events: WEBHOOK_EVENTS,
      delivery: "POST application/json. Headers: X-KudoBird-Event, X-KudoBird-Delivery, X-KudoBird-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` with the endpoint secret>. Reply 2xx within 10 seconds; failures are retried up to 7 times over about a day.",
    },
  };
}
