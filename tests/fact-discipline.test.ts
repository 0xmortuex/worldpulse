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

    const visit = (node: ts.Node): void => {
      // `${...}` inside a template literal that contains markup.
      if (ts.isTemplateExpression(node) && looksLikeMarkup(node.getText())) {
        for (const span of node.templateSpans) report(node, span.expression);
      }

      // Direct assignment to a DOM sink.
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ['innerHTML', 'textContent', 'outerHTML', 'innerText'].includes(node.left.name.text)
      ) {
        report(node, node.right);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
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

  it('catches a planted violation', () => {
    // Proves the rule can fail. Without this, a rule that silently matched
    // nothing would look identical to a clean codebase.
    const configPath = resolve(ROOT, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

    const planted = resolve(ROOT, 'src/__planted__.ts');
    const host = ts.createCompilerHost(parsed.options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const source = 'const n: number = 42;\nexport const html = `<span>${n}</span>`;\n';
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

    let found = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isTemplateExpression(node) && looksLikeMarkup(node.getText())) {
        for (const span of node.templateSpans) {
          if (isNumberLike(checker.getTypeAtLocation(span.expression), checker)) found += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    assert.equal(found, 1, 'the rule failed to flag a plainly numeric interpolation');
  });
});
