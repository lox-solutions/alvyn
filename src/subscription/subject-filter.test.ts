import { describe, expect, it } from "vitest";

import { buildSubjectFilter } from "./subject-filter";

describe("buildSubjectFilter", () => {
  it("treats LIKE metacharacters in recursive subjects as literals", () => {
    const filter = buildSubjectFilter(
      { subject: "Order_%\\", recursive: true },
      3,
    );

    expect(filter.clause).toContain("ESCAPE");
    expect(filter.params).toEqual(["Order_%\\", "Order\\_\\%\\\\%"]);
  });
});
