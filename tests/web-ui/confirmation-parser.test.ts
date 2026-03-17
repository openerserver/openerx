import { describe, expect, it } from "vitest";
import {
  composeConfirmationReply,
  parseConfirmationBlock,
} from "../../control-plane/web-ui/src/lib/confirmation-parser";

const SAMPLE_MD = `
好的，我来理清一下需求。

### 需要你确认
1. **项目形态**
   - 是否接受我在当前仓库内新增一个独立目录，例如 \`ios-keyboard/\`，放 Xcode 工程？
   - 还是你已有现成 iOS 工程，只是我还没找到？

2. **系统版本**
   - 默认按 **iOS 16+** 开发，可以吗？

3. **功能范围**
   默认我会做"最小可用拼音输入法"：
   - 只支持**全拼**
   - 不支持双拼
   - 不支持手写 / 语音 / 英文联想 / 云词库
   - 支持：
     - 拼音串输入
     - 候选词展示
     - 点击候选上屏
     - 删除
     - 空格上屏首候选
     - 回车直接提交当前内容
     - 中/英切换或至少字母直出模式
   这样是否符合预期？

4. **词库来源**
   - 你是否有现成拼音词库？
   - 如果没有，我可以先接入一个**内置小型本地词库**做 MVP。

5. **是否需要联网**
   - 默认做**纯离线输入法**
   - 不接你当前仓库的后端服务
   可以吗？
`;

describe("parseConfirmationBlock", () => {
  it("detects the heading and extracts all questions", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    expect(result?.heading).toBe("需要你确认");
    expect(result?.questions).toHaveLength(5);
  });

  it("parses question titles correctly", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected confirmation block to parse");
    expect(result.questions[0].title).toBe("项目形态");
    expect(result.questions[1].title).toBe("系统版本");
    expect(result.questions[2].title).toBe("功能范围");
    expect(result.questions[3].title).toBe("词库来源");
    expect(result.questions[4].title).toBe("是否需要联网");
  });

  it("extracts options from sub-bullets", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected confirmation block to parse");
    const q1 = result.questions[0]; // 项目形态
    expect(q1.options.length).toBe(2);
    expect(q1.options[0].text).toContain("是否接受");
    expect(q1.options[1].text).toContain("还是你已有");
  });

  it("detects yes-no answer type", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected confirmation block to parse");
    // 系统版本 - has "可以吗？"
    expect(result.questions[1].answerType).toBe("yes-no");
    // 是否需要联网 - has "可以吗？"
    expect(result.questions[4].answerType).toBe("yes-no");
  });

  it("detects single-choice answer type for 2-option questions", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected confirmation block to parse");
    // 项目形态 has exactly 2 options
    expect(result.questions[0].answerType).toBe("single-choice");
    // 词库来源 has exactly 2 options
    expect(result.questions[3].answerType).toBe("single-choice");
  });

  it("returns null for text without confirmation pattern", () => {
    expect(parseConfirmationBlock("Hello world")).toBeNull();
    expect(parseConfirmationBlock("### 普通标题\n- item 1\n- item 2")).toBeNull();
  });

  it("returns null when no numbered items follow the heading", () => {
    expect(parseConfirmationBlock("### 需要你确认\n\n没有编号列表")).toBeNull();
  });
});

describe("composeConfirmationReply", () => {
  it("formats answers as numbered markdown list", () => {
    const result = parseConfirmationBlock(SAMPLE_MD);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected confirmation block to parse");
    const answers = new Map<number, string>();
    answers.set(1, "接受在当前仓库新增目录");
    answers.set(2, "可以");
    answers.set(5, "可以");

    const reply = composeConfirmationReply(result.questions, answers);
    expect(reply).toContain("1. **项目形态**：接受在当前仓库新增目录");
    expect(reply).toContain("2. **系统版本**：可以");
    expect(reply).toContain("5. **是否需要联网**：可以");
    // Unanswered questions should not appear
    expect(reply).not.toContain("3.");
    expect(reply).not.toContain("4.");
  });
});
