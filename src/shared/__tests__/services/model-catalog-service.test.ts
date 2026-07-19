import { describe, expect, it, vi } from "vitest";
import { ModelCatalogService } from "../../services/model-catalog-service.js";

describe("ModelCatalogService", () => {
  it("should send bearer token to the models endpoint and parse OpenAI style data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "model-a" }, { id: "model-b" }],
      }),
    });
    const service = new ModelCatalogService(fetchMock as typeof fetch);

    const result = await service.fetch({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
    expect(result.models).toEqual(["model-a", "model-b"]);
  });

  it("should send x-api-key and parse string arrays", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ["model-a", "model-b"],
      });
    const service = new ModelCatalogService(fetchMock as typeof fetch);

    const result = await service.fetch({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-test",
        }),
      }),
    );
    expect(result.models).toEqual(["model-a", "model-b"]);
  });

  it("should fall back to /v1/models and parse object arrays", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: "model-a" }, { name: "model-b" }, { model: "model-c" }],
      });
    const service = new ModelCatalogService(fetchMock as typeof fetch);

    const result = await service.fetch({
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/models",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.example.com/v1/models",
      expect.any(Object),
    );
    expect(result.models).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("should surface an error when all probes fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      });
    const service = new ModelCatalogService(fetchMock as typeof fetch);

    await expect(
      service.fetch({
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
      }),
    ).rejects.toThrow(/401|404/);
  });
});
