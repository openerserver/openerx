"use strict";

// Local maintenance fix for GHSA-vfj7-8cjw-p6xm. These hard limits are not
// controlled by caller options. Validation itself never recurses.
const MAX_AST_DEPTH = 128;
const MAX_AST_NODES = 131074; // At least two nodes per upstream MAX_LENGTH char.

const failure = (code, message) => {
  const error = new RangeError(message);
  error.code = code;
  return error;
};

exports.assertParseDepth = (depth) => {
  if (depth >= MAX_AST_DEPTH) {
    throw failure("BRACES_MAX_DEPTH", "braces AST nesting exceeds the fixed security limit (128)");
  }
};

exports.assertAst = (ast) => {
  const active = new WeakSet();
  const stack = [{ node: ast, depth: 0, index: -1 }];
  let visited = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === -1) {
      if (!frame.node || typeof frame.node !== "object") {
        throw new TypeError("Expected an AST node");
      }
      // Recursive Array#toString coercion is unsafe even in an otherwise shallow AST.
      for (const field of ["type", "value", "ranges", "commas"]) {
        const value = frame.node[field];
        const expected = field === "ranges" || field === "commas" ? "number" : "string";
        if (value !== undefined && typeof value !== expected) {
          const error = new TypeError(`Invalid braces AST field: ${field}`);
          error.code = "BRACES_INVALID_AST";
          throw error;
        }
      }
      if (frame.depth > MAX_AST_DEPTH) {
        throw failure(
          "BRACES_MAX_DEPTH",
          "braces AST nesting exceeds the fixed security limit (128)",
        );
      }
      if (++visited > MAX_AST_NODES) {
        throw failure("BRACES_MAX_NODES", "braces AST exceeds the fixed security node limit");
      }
      if (active.has(frame.node)) {
        throw failure("BRACES_INVALID_AST", "braces AST contains a child cycle");
      }
      const nodes = frame.node.nodes;
      if (nodes !== undefined && !Array.isArray(nodes)) {
        throw new TypeError("Expected AST nodes to be an array");
      }
      if (nodes && nodes.length > MAX_AST_NODES) {
        throw failure("BRACES_MAX_NODES", "braces AST exceeds the fixed security node limit");
      }
      frame.nodes = nodes;
      frame.index = 0;
      active.add(frame.node);
    }
    if (frame.nodes && frame.index < frame.nodes.length) {
      stack.push({ node: frame.nodes[frame.index++], depth: frame.depth + 1, index: -1 });
    } else {
      active.delete(frame.node);
      stack.pop();
    }
  }
};
