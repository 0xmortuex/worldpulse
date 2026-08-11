import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relative, resolve, sep } from 'node:path';
import ts from 'ts-analyzer';
import { REGISTERED_RENDER_HELPERS, SANCTIONED_RENDER_HELPERS } from '../src/facts/discipline';

/**
 * The number-to-string bypass rule.
 *
 * `tests/fact-discipline.test.ts` is enforced through the type system: a
 * number-typed expression must not reach DOM-bound markup. That makes ANY
 * function returning `string` a potential bypass — the rule cannot distinguish
 * `notAFact(n, reason)` from a local `signed(n)` that quietly calls
 * `String(value)`. Two independent copies of exactly that helper existed, both
 * rendering slider weights. They happened to be rendering something that is
 * genuinely not a fact, so nothing was mislabelled; but the rule was not what
 * was keeping it that way, and two copies of the same bypass is a pattern.
 *
 * The laundering signature is specific: a call, in a render path, that takes a
 * NUMBER and yields a STRING. Functions with no numeric input cannot launder a
 * number, and their own bodies are covered by the fact-discipline rule already —
 * so a markup composer built out of `factHtml()` calls needs no entry here. That
 * keeps this registry small enough to stay read rather than skimmed.
 *
 * Every such call must be sanctioned or registered with a justification, and a
 * registered helper declared in this repo must actually route through one of the
 * sanctioned helpers — otherwise a second helper could take a registered name
 * and inherit its exemption without inheriting its behaviour.
 */

const ROOT = resolve(import.meta.dirname, '..');
const EXEMPT_PREFIXES = [`src${sep}facts${sep}`];

/** Markup-boundness, inherited exactly as in the fact-discipline rule. */
function looksLikeMarkup(text: string): boolean {
  return /<\/?[a-zA-Z][\w-]*/.test(text);
}

interface Launder {
  name: string;
  file: string;
  line: number;
  /** Method call on a numeric receiver (`value.toFixed(1)`). */
  method: boolean;
  /** Source text of the declaration, when it is declared in this repo. */
  declaration: string | null;
}

function isNumberLike(type: ts.Type, checker: ts.TypeChecker): boolean {
  const constituents = type.isUnion() ? type.types : [type];
  return constituents.some(
    (constituent) => (checker.getBaseTypeOfLiteralType(constituent).flags & ts.TypeFlags.NumberLike) !== 0,
  );
}

function collectLaunderings(): Launder[] {
  const configPath = resolve(ROOT, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const found: Launder[] = [];

  /** The body of the called function, when it is declared in our own source. */
  const declarationText = (callee: ts.Expression): string | null => {
    const symbol = checker.getSymbolAtLocation(callee);
    const resolved = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = resolved?.declarations?.[0];
    if (!declaration) return null;
    const file = declaration.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes('node_modules')) return null;
    return declaration.getText();
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const relativePath = relative(ROOT, sourceFile.fileName);
    if (relativePath.startsWith('..') || relativePath.includes('node_modules')) continue;
    if (!relativePath.startsWith(`src${sep}`)) continue;
    if (EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) continue;

    const record = (node: ts.CallExpression): void => {
      if ((checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) === 0) return;

      const callee = node.expression;
      const isMethod = ts.isPropertyAccessExpression(callee);

      // A number reaches a string either as an argument (`fmt(value)`) or as the
      // receiver of a method (`value.toFixed(1)`). Numeric arguments to a method
      // on a STRING receiver — `text.slice(0, 16)` — launder nothing, so the
      // receiver is what is tested for method calls.
      const laundersNumber = isMethod
        ? isNumberLike(checker.getTypeAtLocation(callee.expression), checker)
        : node.arguments.some((argument) => isNumberLike(checker.getTypeAtLocation(argument), checker));
      if (!laundersNumber) return;

      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      found.push({
        name: isMethod ? callee.name.text : callee.getText(),
        file: relativePath,
        line: line + 1,
        method: isMethod,
        declaration: isMethod ? null : declarationText(callee),
      });
    };

    const visit = (node: ts.Node, bound: boolean): void => {
      let inherited = bound;

      if (ts.isTemplateExpression(node)) {
        inherited = bound || looksLikeMarkup(node.getText());
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ['innerHTML', 'textContent', 'outerHTML', 'innerText'].includes(node.left.name.text)
      ) {
        inherited = true;
      }

      if (inherited && ts.isCallExpression(node)) record(node);

      ts.forEachChild(node, (child) => visit(child, inherited));
    };

    visit(sourceFile, false);
  }

  return found;
}

const LAUNDERINGS = collectLaunderings();

describe('render-helper registry', () => {
  it('finds number-to-string conversions in render paths at all', () => {
    // Rule 10. If the traversal stopped matching, every assertion below would
    // pass against an empty list — the shape of every vacuous check in this repo.
    assert.ok(
      LAUNDERINGS.length >= 10,
      `only ${LAUNDERINGS.length} number-to-string conversions found in render paths; the scan is probably broken`,
    );
  });

  it('every number-to-string conversion reaching markup is sanctioned or registered', () => {
    const unregistered = LAUNDERINGS.filter(
      (entry) =>
        !SANCTIONED_RENDER_HELPERS.includes(entry.name) && REGISTERED_RENDER_HELPERS[entry.name] === undefined,
    );

    const detail = [...new Set(unregistered.map((entry) => `${entry.name}() at ${entry.file}:${entry.line}`))]
      .map((line) => `\n  ${line}`)
      .join('');

    assert.equal(
      unregistered.length,
      0,
      `${unregistered.length} call(s) turn a number into a string inside DOM markup without being\n` +
        'sanctioned or registered. The fact-discipline rule is enforced through types, so it sees a\n' +
        'string and waves these through. Render the value with factHtml(fact), or notAFact(value, reason),\n' +
        'or add the helper to REGISTERED_RENDER_HELPERS in src/facts/discipline.ts with a justification.' +
        detail,
    );
  });

  it('every registered justification is a real sentence', () => {
    // Mirrors notAFact's reason floor. An entry reading "ok" would satisfy the
    // rule while explaining nothing.
    for (const [name, justification] of Object.entries(REGISTERED_RENDER_HELPERS)) {
      assert.ok(
        justification.trim().length >= 40,
        `justification for "${name}" is too short to be one: ${JSON.stringify(justification)}`,
      );
    }
  });

  it('registered helpers declared in this repo route through a sanctioned helper', () => {
    // Without this, a NEW function could take a registered name and inherit the
    // exemption without inheriting the behaviour that earned it.
    //
    // A chain counts: portraitFrame renders its pixel size through px(), which
    // renders through notAFact. Every link is itself registered and checked, so
    // the chain has to bottom out at a sanctioned helper — what is forbidden is
    // a helper that reaches the DOM through none of them.
    const chain = [...SANCTIONED_RENDER_HELPERS, ...Object.keys(REGISTERED_RENDER_HELPERS)];
    const routes = new RegExp(`\\b(${chain.join('|')})\\(`);

    const offenders = LAUNDERINGS.filter(
      (entry) =>
        REGISTERED_RENDER_HELPERS[entry.name] !== undefined &&
        entry.declaration !== null &&
        !routes.test(entry.declaration),
    ).map((entry) => `${entry.name} (${entry.file}:${entry.line})`);

    assert.deepEqual(
      [...new Set(offenders)],
      [],
      'registered helper(s) no longer route through factHtml or notAFact; the registry entry is now a lie',
    );
  });

  it('registers no helper that has stopped reaching a render path', () => {
    // A registry that only grows becomes a list of exemptions nobody has read.
    const reaching = new Set(LAUNDERINGS.map((entry) => entry.name));
    const stale = Object.keys(REGISTERED_RENDER_HELPERS).filter((name) => !reaching.has(name));
    assert.deepEqual(stale, [], `registered helpers that no longer reach any render path: ${stale.join(', ')}`);
  });

  it('catches a planted bypass', () => {
    // Proves the rule can fail, on the exact shape that defeated the old one:
    // a local helper that takes a number and returns a string.
    const configPath = resolve(ROOT, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

    const planted = resolve(ROOT, 'src/__planted-helper__.ts');
    const source =
      'function signed(value: number): string { return value > 0 ? `+${value}` : String(value); }\n' +
      'export const html = `<span class="weight">${signed(3)}</span>`;\n';

    const host = ts.createCompilerHost(parsed.options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
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
    const visit = (node: ts.Node, bound: boolean): void => {
      let inherited = bound;
      if (ts.isTemplateExpression(node)) inherited = bound || looksLikeMarkup(node.getText());
      if (inherited && ts.isCallExpression(node) && !ts.isPropertyAccessExpression(node.expression)) {
        const returnsString = (checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) !== 0;
        const takesNumber = node.arguments.some((argument) =>
          isNumberLike(checker.getTypeAtLocation(argument), checker),
        );
        if (returnsString && takesNumber) found.push(node.expression.getText());
      }
      ts.forEachChild(node, (child) => visit(child, inherited));
    };
    visit(sourceFile, false);

    assert.deepEqual(found, ['signed'], 'the rule failed to flag a planted number-to-string helper');
  });
});
