# Legal & Code Provenance

## License Compliance

- **OpenCode**: MIT License — free to use, modify, distribute.
- **Oh-My-OpenAgent**: SUL License (restricted) — **DO NOT** vendor, copy, or fork any code.
- **Opener-X Enterprise Extensions**: MIT License (our own code).

## Clean-Room Rules

1. **Prohibited**: Directly copying, vendoring, or adapting code from SUL-licensed repositories.
2. **Allowed**: Implementing equivalent capabilities based on publicly available documentation, README descriptions, blog posts, and observable behavior.
3. **Required**: Every PR must include a "Code Provenance" field in the PR template declaring the origin of the implementation (original / based on docs / based on public API behavior).

## PR Template — Code Provenance Section

```markdown
## Code Provenance
- [ ] This code is original implementation
- [ ] This code is based on public documentation of: ___
- [ ] This code adapts an existing MIT/Apache-2.0 licensed project: ___
- [ ] None of this code is derived from restricted-license sources
```

## Audit Process

- **Monthly**: Security Engineer randomly samples 5 files for provenance review.
- **Quarterly**: Full legal compliance audit of new additions.
- **Violation**: Immediate revert + incident report.
