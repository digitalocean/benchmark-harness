import { describe, expect, it } from "bun:test";

import { isRetryableSpacesError, spacesErrorDetails } from "./spaces";

describe("Spaces errors", () => {
  it("extracts AWS metadata and nested causes", () => {
    const cause = Object.assign(new Error("socket disconnected"), {
      code: "ECONNRESET",
    });
    const error = Object.assign(new Error("upload failed", { cause }), {
      name: "ServiceUnavailable",
      Code: "SlowDown",
      $metadata: {
        httpStatusCode: 503,
        requestId: "request-id",
        extendedRequestId: "extended-request-id",
        attempts: 2,
        totalRetryDelay: 100,
      },
    });

    expect(spacesErrorDetails(error)).toMatchObject({
      name: "ServiceUnavailable",
      message: "upload failed",
      code: "SlowDown",
      httpStatusCode: 503,
      requestId: "request-id",
      extendedRequestId: "extended-request-id",
      attempts: 2,
      totalRetryDelay: 100,
      cause: {
        name: "Error",
        message: "socket disconnected",
        code: "ECONNRESET",
      },
    });
  });

  it("falls back to response metadata", () => {
    const error = Object.assign(new Error("unknown response"), {
      $response: {
        statusCode: 429,
        headers: {
          "x-amz-request-id": "header-request-id",
          "x-amz-id-2": "header-extended-id",
          "cf-ray": "cloudflare-id",
        },
      },
    });

    expect(spacesErrorDetails(error)).toMatchObject({
      httpStatusCode: 429,
      requestId: "header-request-id",
      extendedRequestId: "header-extended-id",
      cfId: "cloudflare-id",
    });
  });

  it("retries transient and unknown errors but not client errors", () => {
    expect(
      isRetryableSpacesError({ name: "Error", message: "network failure" })
    ).toBe(true);
    for (const status of [408, 409, 429, 500, 503]) {
      expect(
        isRetryableSpacesError({
          name: "Error",
          message: "transient failure",
          httpStatusCode: status,
        })
      ).toBe(true);
    }
    for (const status of [400, 401, 403, 404]) {
      expect(
        isRetryableSpacesError({
          name: "Error",
          message: "client failure",
          httpStatusCode: status,
        })
      ).toBe(false);
    }
  });
});
