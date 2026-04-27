import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("api worker routes", () => {
  it("returns health payload", async () => {
    const res = await app.request("https://api.example.com/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("returns bootstrap debate payload", async () => {
    const res = await app.request("https://api.example.com/v1/debate/risk-assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric: "volatility" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.metric).toBe("volatility");
    expect(typeof data.conviction).toBe("number");
  });
});
