import { expect, test } from "vitest";
import { skillSummary } from "../src/renderer/skill-summary";

test.each(["documents", "pdf", "presentations", "spreadsheets", "structured-report"])(
  "uses a concise Chinese summary for the bundled %s Skill without exposing its instruction text",
  (name) => {
    const result = skillSummary({
      name,
      scope: "builtin",
      displayName: name,
      description: "Long English package instructions.",
    });
    expect(result.description).toMatch(/[\u4e00-\u9fff]/u);
    expect(result.description.length).toBeLessThanOrEqual(30);
    expect(result.description).not.toContain("package instructions");
  },
);

test.each(["personal", "workspace"] as const)(
  "preserves the publisher's name and description for a %s Skill with a bundled name",
  (scope) => {
    expect(
      skillSummary({
        name: "documents",
        scope,
        displayName: "企业合同审核",
        description: "核对企业合同中的付款条款与审批记录。",
      }),
    ).toEqual({
      name: "企业合同审核",
      description: "核对企业合同中的付款条款与审批记录。",
    });
  },
);

test.each(["future-skill", "constructor", "__proto__"])(
  "retains the supplied summary for the unknown bundled Skill %s",
  (name) => {
    expect(
      skillSummary({
        name,
        scope: "builtin",
        displayName: "新能力",
        description: "新能力说明。",
      }),
    ).toEqual({
      name: "新能力",
      description: "新能力说明。",
    });
  },
);
