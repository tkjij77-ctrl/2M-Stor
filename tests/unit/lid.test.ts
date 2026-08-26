import { describe, it, expect } from "vitest";
import { getQ, getQs, getMin, firstNum } from "@/lib/db/lid";

describe("lid helpers", () => {
  it("getQ/getQs defaults", () => {
    expect(getQ({})).toBe(0);
    expect(getQs({})).toBe(0);
    expect(getQ({ q: 5 })).toBe(5);
    expect(getQs({ qs: 3 })).toBe(3);
  });
  it("firstNum", () => {
    expect(firstNum("100 - 150")).toBe(100);
    expect(firstNum("7.5")).toBe(7.5);
    expect(firstNum("جـ الواحد")).toBe(0);
  });
});
