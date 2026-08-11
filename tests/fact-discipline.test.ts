import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'ts-analyzer';

/**
 * The fact-discipline rule.
 *
 * The confidence badge is the only sanctioned way to render a fact. This test
 * fails when a numeric expression is interpolated into DOM-bound markup anywhere
 * outside `src/facts/`.
 *
 * It uses real type information rather than pattern matching, so it cannot be
 * fooled by an intermediate variable: `const n = fact.value; html += \`${n}\``
 * is caught the same as interpolating the property directly.
 *
 * Compliance falls out of the type system. The two sanctioned helpers both
 * return `string`, so code that uses them passes automatically:
 *
 *   factHtml(fact)              — renders the value with its badge and provenance
 *   notAFact(value, reason)     — for numbers that genuinely are not facts
 *
 * Anything else numeric has to be one of those, or it fails here.
 *
 * Uses typescript@5 (aliased as `ts-analyzer`) rather than the repo's
 * typescript@7: the 7.x native port does not yet expose a JS compiler API with
 * a type checker. The alias exists solely for this rule and is not used to
 * build or typecheck the app.
 */

const ROOT = resolve(import.meta.dirname, '..');

/** Directories where rendering a raw number is the whole point. */
const EXEMPT_PREFIXES = [`src${sep}facts${sep}`];

interface Violation {
  file: string;
  line: number;
  expression: string;
  type: string;
  snippet: string;
}

function isNumberLike(type: ts.Type, checker: ts.TypeChecker): boolean {
  const constituents = type.isUnion() ? type.types : [type];
  return constituents.some((constituent) => {
    // Widen literal types (`3`) to their base (`number`) before testing.
    const widened = checker.getBaseTypeOfLiteralType(constituent);
    return (widened.flags & ts.TypeFlags.NumberLike) !== 0;
  });
}

/** Heuristic for "this string becomes DOM": it contains markup. */
function looksLikeMarkup(text: string): boolean {
  return /<\/?[a-zA-Z][\w-]*/.test(text);
}

/**
 * A template nested inside a markup template's `${...}` is DOM-bound too.
 *
 * The first version of this rule only looked at templates whose OWN text
 * contained a tag, so one level of nesting defeated it entirely:
 *
 *   `<div>${m === null ? 'none' : `M${m}`}</div>`
 *
 * The outer span's type is `string`, and the inner template has no tag in it, so
 * a raw USGS magnitude reached the DOM with nothing flagged. The wrapper is not
 * where the number stops being a fact, so markup-boundness is inherited rather
 * than re-derived at each level.
 */
type MarkupBound = boolean;

/**
 * The traversal itself, shared with the positive control below.
 *
 * Deliberately one function rather than two similar ones: the planted-violation
 * test only proves the rule can fail if it walks the SAME code the real scan
 * walks. A copy would keep passing while the real traversal quietly stopped
 * matching anything.
 */
function scan(
  sourceFile: ts.SourceFile,
  onCandidate: (node: ts.Node, expression: ts.Expression) => void,
): void {
  const visit = (node: ts.Node, bound: MarkupBound): void => {
    let inherited = bound;

    // `${...}` inside a template literal that contains markup — or inside one
    // that is itself interpolated into such a template.
    if (ts.isTemplateExpression(node)) {
      inherited = bound || looksLikeMarkup(node.getText());
      if (inherited) {
        for (const span of node.templateSpans) onCandidate(node, span.expression);
      }
    }

    // Direct assignment to a DOM sink.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ['innerHTML', 'textContent', 'outerHTML', 'innerText'].includes(node.left.name.text)
    ) {
      onCandidate(node, node.right);
      inherited = true;
    }

    ts.forEachChild(node, (child) => visit(child, inherited));
  };

  visit(sourceFile, false);
}

function collectViolations(): Violation[] {
  const configPath = resolve(ROOT, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(configFile.error, undefined, 'could not read tsconfig.json');

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const violations: Violation[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const relativePath = relative(ROOT, sourceFile.fileName);
    if (relativePath.startsWith('..') || relativePath.includes('node_modules')) continue;
    if (!relativePath.startsWith(`src${sep}`)) continue;
    if (EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) continue;

    const report = (node: ts.Node, expression: ts.Expression): void => {
      const type = checker.getTypeAtLocation(expression);
      if (!isNumberLike(type, checker)) return;
      const { line } = sourceFile.getLineAndCharacterOfPosition(expression.getStart());
      violations.push({
        file: relativePath,
        line: line + 1,
        expression: expression.getText(),
        type: checker.typeToString(type),
        snippet: node.getText().slice(0, 120).replace(/\s+/g, ' '),
      });
    };

    scan(sourceFile, report);
  }

  return violations;
}

describe('fact discipline', () => {
  it('renders no number to the DOM outside the badge component', () => {
    const violations = collectViolations();

    const detail = violations
      .map(
        (violation) =>
          `\n  ${violation.file}:${violation.line}\n` +
          `    expression: ${violation.expression}  (type: ${violation.type})\n` +
          `    in: ${violation.snippet}`,
      )
      .join('');

    assert.equal(
      violations.length,
      0,
      `${violations.length} number(s) reach the DOM outside src/facts/.\n` +
        'Every rendered fact must carry a confidence badge. Wrap the value with ' +
        'factHtml(fact), or — if it genuinely is not a fact — with ' +
        'notAFact(value, reason) and say why.' +
        detail,
    );
  });

  it('recognises the sanctioned helpers as string-producing', () => {
    // Guards the rule itself: if either helper ever stops returning string, the
    // rule would start flagging every compliant call site and get disabled.
    const badge = readFileSync(resolve(ROOT, 'src/facts/badge.ts'), 'utf8');
    const discipline = readFileSync(resolve(ROOT, 'src/facts/discipline.ts'), 'utf8');
    assert.match(badge, /export function factHtml<T>\([^)]*\): string/s);
    assert.match(discipline, /export function notAFact\([^)]*\): string/s);
  });

  it('catches a planted violation, including one template deep', () => {
    // Proves the rule can fail. Without this, a rule that silently matched
    // nothing would look identical to a clean codebase.
    //
    // The nested case is here because the rule genuinely did NOT catch it: a
    // number wrapped in an inner template escaped a scan that only looked at
    // templates containing a tag. Planting both means the nesting fix is itself
    // covered, rather than trusted.
    const configPath = resolve(ROOT, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

    // Forward slashes, always. TypeScript normalises every `fileName` it hands
    // to a compiler host, so on Windows a backslash path never matches the
    // `fileName === planted` comparisons below: the host silently falls through
    // to the real filesystem, the planted file is never created, and the check
    // that proves this rule can fail is itself the thing that fails.
    const planted = `${resolve(ROOT, 'src/__planted__.ts').replace(/\\/g, '/')}`;
    const host = ts.createCompilerHost(parsed.options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const source =
      'const n: number = 42;\n' +
      'const m: number | null = 7;\n' +
      'export const html = `<span>${n}</span>`;\n' +
      // The wrapping template has no tag of its own, and the outer span's type
      // is `string` — the exact shape that used to slip through.
      'export const nested = `<div>${m === null ? "none" : `M${m}`}</div>`;\n';
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
      fileName === planted
        ? ts.createSourceFile(fileName, source, languageVersion, true)
        : originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    host.fileExists = (fileName) => fileName === planted || ts.sys.fileExists(fileName);
    host.readFile = (fileName) => (fileName === planted ? source : ts.sys.readFile(fileName));

    const program = ts.createProgram({ rootNames: [planted], options: parsed.options, host });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(planted);
    assert.ok(sourceFile);

    const found: string[] = [];
    scan(sourceFile, (_node, expression) => {
      if (isNumberLike(checker.getTypeAtLocation(expression), checker)) found.push(expression.getText());
    });

    assert.deepEqual(
      found.sort(),
      ['m', 'n'],
      'the rule failed to flag a planted numeric interpolation (`n` direct, `m` nested one template deep)',
    );
  });
});
