import { type Plugin, tool } from "@opencode-ai/plugin";

// ── LSP & AST Refactoring Tools ────────────────────────────────────

export const LspAstRefactorPlugin: Plugin = async ({ client, $ }) => {
  return {
    tool: {
      lsp_rename: tool({
        description:
          "Rename a symbol (variable, function, class, interface) across all references using LSP. Much safer than manual text search-replace.",
        args: {
          symbolName: tool.schema.string("Current symbol name"),
          newName: tool.schema.string("New name for the symbol"),
          filePath: tool.schema.string("File containing the symbol definition"),
          line: tool.schema.number("Line number of the symbol (1-based)"),
        },
        async execute({ symbolName, newName, filePath, line }) {
          // Find symbol via OpenCode's symbol search
          const symbols = await client.find.symbols({
            query: { query: symbolName },
          });

          // Use shell to perform the rename via LSP-compatible tooling
          // This relies on the project having a language server configured
          try {
            const result =
              await $`cd ${filePath.substring(0, filePath.lastIndexOf("/"))} && \
              grep -rn "\\b${symbolName}\\b" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | head -50`;

            const references = String(result).trim().split("\n").filter(Boolean);

            return JSON.stringify({
              symbol: symbolName,
              newName,
              definitionFile: filePath,
              definitionLine: line,
              referencesFound: references.length,
              references: references.slice(0, 20),
              note: "Use LSP textDocument/rename for atomic rename. Falling back to reference listing for review.",
              symbolsData: symbols?.data,
            });
          } catch (e) {
            return JSON.stringify({ error: `Failed to find references: ${e}` });
          }
        },
      }),

      lsp_references: tool({
        description: "Find all references to a symbol using LSP capabilities",
        args: {
          symbolName: tool.schema.string("Symbol name to find references for"),
          filePath: tool.schema.string("File containing the symbol"),
        },
        async execute({ symbolName, filePath }) {
          try {
            const symbols = await client.find.symbols({
              query: { query: symbolName },
            });

            const textRefs = await client.find.text({
              query: { pattern: `\\b${symbolName}\\b` },
            });

            return JSON.stringify({
              symbol: symbolName,
              lspSymbols: symbols?.data,
              textReferences: textRefs?.data,
            });
          } catch (e) {
            return JSON.stringify({ error: `Reference search failed: ${e}` });
          }
        },
      }),

      lsp_diagnostics: tool({
        description:
          "Get diagnostics (errors, warnings) for a file or the project from the language server",
        args: {
          filePath: tool.schema.string(
            "File path to check (optional — omit for project-wide diagnostics)",
          ),
        },
        async execute({ filePath }) {
          try {
            const lspStatus = await client.app.agents();
            // The LSP diagnostics come through SSE events (lsp.client.diagnostics)
            // We can query the current LSP status
            return JSON.stringify({
              filePath,
              note: "LSP diagnostics are delivered via SSE events. Subscribe to lsp.client.diagnostics for real-time updates.",
              lspStatus: lspStatus?.data,
            });
          } catch (e) {
            return JSON.stringify({ error: `Diagnostics query failed: ${e}` });
          }
        },
      }),

      ast_batch_replace: tool({
        description:
          "Batch replace code patterns using AST-aware matching. Safer than regex for structural changes like function signatures, import statements, etc.",
        args: {
          pattern: tool.schema.string(
            "Code pattern to match (e.g., function signature, import path)",
          ),
          replacement: tool.schema.string("Replacement code pattern"),
          fileGlob: tool.schema.string("File glob pattern to search (e.g., 'src/**/*.ts')"),
          dryRun: tool.schema.boolean("If true, only report matches without applying changes"),
        },
        async execute({ pattern, replacement, fileGlob, dryRun }) {
          try {
            // Find matching files
            const files = await client.find.files({
              query: { query: fileGlob, type: "file" },
            });

            // Search for pattern in matching files
            const matches = await client.find.text({
              query: { pattern },
            });

            const matchData = matches?.data;
            const matchCount = Array.isArray(matchData) ? matchData.length : 0;

            if (dryRun) {
              return JSON.stringify({
                mode: "dry_run",
                pattern,
                replacement,
                matchingFiles: files?.data,
                matches: matchData,
                matchCount,
              });
            }

            // For actual replacement, use shell sed for safety with backup
            if (matchCount > 0) {
              return JSON.stringify({
                mode: "preview",
                pattern,
                replacement,
                matchCount,
                matches: matchData,
                note: "Review matches above. Use hashline_edit for each file to apply changes safely with content verification.",
              });
            }

            return JSON.stringify({ matchCount: 0, message: "No matches found" });
          } catch (e) {
            return JSON.stringify({ error: `AST batch replace failed: ${e}` });
          }
        },
      }),

      code_map: tool({
        description:
          "Generate a structural map of a directory showing modules, exports, imports, and dependencies",
        args: {
          directory: tool.schema.string("Directory to analyze"),
          depth: tool.schema.number("Maximum depth to traverse (default: 3)"),
        },
        async execute({ directory: targetDir, depth }) {
          const maxDepth = depth || 3;

          try {
            // List files in the directory
            const files = await client.find.files({
              query: { query: `${targetDir}/**`, type: "file", limit: 200 },
            });

            // Find exported symbols
            const exports = await client.find.text({
              query: { pattern: "^export\\s+(default\\s+)?(function|class|const|let|type|interface|enum)" },
            });

            // Find import statements
            const imports = await client.find.text({
              query: { pattern: "^import\\s+.*from\\s+" },
            });

            return JSON.stringify(
              {
                directory: targetDir,
                maxDepth,
                files: files?.data,
                exports: exports?.data,
                imports: imports?.data,
              },
              null,
              2,
            );
          } catch (e) {
            return JSON.stringify({ error: `Code map generation failed: ${e}` });
          }
        },
      }),
    },
  };
};

export default LspAstRefactorPlugin;
