import type { Monitor, NewsItem } from '@/types';

type SearchField = 'body' | 'title' | 'url' | 'site';
type DateField = 'after' | 'before' | 'when';
type MetadataField = 'hl' | 'gl' | 'ceid';
type KnownField = SearchField | 'intitle' | 'inurl' | 'allintitle' | DateField | MetadataField;

interface WordToken {
  type: 'word' | 'phrase';
  value: string;
}

interface FieldToken {
  type: 'field';
  field: KnownField;
  value: string;
  phrase: boolean;
}

type QueryToken =
  | WordToken
  | FieldToken
  | { type: 'operator'; value: 'AND' | 'OR' }
  | { type: 'not' }
  | { type: 'lparen' }
  | { type: 'rparen' };

type TextQueryNode =
  | { type: 'term'; value: string; phrase: boolean; field: SearchField }
  | { type: 'date'; field: DateField; value: string }
  | { type: 'metadata' }
  | { type: 'allintitle'; terms: Array<{ value: string; phrase: boolean }> };

type MonitorQueryNode =
  | TextQueryNode
  | { type: 'and' | 'or'; children: MonitorQueryNode[] }
  | { type: 'not'; child: MonitorQueryNode }
  | { type: 'all' };

export interface CompiledMonitorQuery {
  raw: string;
  ast: MonitorQueryNode;
}

export interface MonitorGoogleNewsSearch {
  query: string;
  hl: string;
  gl: string;
  ceid: string;
}

const KNOWN_FIELDS = new Set<KnownField>([
  'body',
  'title',
  'url',
  'site',
  'intitle',
  'inurl',
  'allintitle',
  'after',
  'before',
  'when',
  'hl',
  'gl',
  'ceid',
]);

const FIELD_ALIASES: Record<KnownField, SearchField | DateField | MetadataField | 'allintitle'> = {
  body: 'body',
  title: 'title',
  url: 'url',
  site: 'site',
  intitle: 'title',
  inurl: 'url',
  allintitle: 'allintitle',
  after: 'after',
  before: 'before',
  when: 'when',
  hl: 'hl',
  gl: 'gl',
  ceid: 'ceid',
};

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isKnownField(value: string): value is KnownField {
  return KNOWN_FIELDS.has(value.toLocaleLowerCase() as KnownField);
}

export function isMonitorQueryField(value: string): boolean {
  return isKnownField(value);
}

function parseQuotedValue(query: string, startIndex: number): { value: string; nextIndex: number } {
  let value = '';
  let index = startIndex + 1;

  while (index < query.length) {
    const char = query[index];
    if (char === '"' && query[index - 1] !== '\\') {
      return { value, nextIndex: index + 1 };
    }
    value += char ?? '';
    index += 1;
  }

  return { value, nextIndex: index };
}

function readBareValue(query: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex;
  while (index < query.length && !/[\s(),]/.test(query[index] ?? '')) {
    index += 1;
  }
  return { value: query.slice(startIndex, index), nextIndex: index };
}

function tokenizeMonitorQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    if (!char) break;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'operator', value: 'OR' });
      index += 1;
      continue;
    }

    if (char === '-') {
      tokens.push({ type: 'not' });
      index += 1;
      continue;
    }

    if (char === '"') {
      const parsed = parseQuotedValue(query, index);
      tokens.push({ type: 'phrase', value: parsed.value });
      index = parsed.nextIndex;
      continue;
    }

    const fieldMatch = query.slice(index).match(/^([a-z][a-z0-9]*)(:|=)/i);
    if (fieldMatch?.[1] && isKnownField(fieldMatch[1])) {
      const field = fieldMatch[1].toLocaleLowerCase() as KnownField;
      let valueStart = index + fieldMatch[0].length;
      while (query[valueStart] === ' ') valueStart += 1;

      if (query[valueStart] === '"') {
        const parsed = parseQuotedValue(query, valueStart);
        tokens.push({ type: 'field', field, value: parsed.value, phrase: true });
        index = parsed.nextIndex;
      } else {
        const parsed = readBareValue(query, valueStart);
        tokens.push({ type: 'field', field, value: parsed.value, phrase: false });
        index = parsed.nextIndex;
      }
      continue;
    }

    const parsed = readBareValue(query, index);
    const upperValue = parsed.value.toLocaleUpperCase();
    if (upperValue === 'AND' || upperValue === 'OR') {
      tokens.push({ type: 'operator', value: upperValue });
    } else if (parsed.value) {
      tokens.push({ type: 'word', value: parsed.value });
    }
    index = parsed.nextIndex;
  }

  return tokens;
}

function quoteQueryValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function serializeQueryToken(token: QueryToken): string {
  if (token.type === 'word') return token.value;
  if (token.type === 'phrase') return quoteQueryValue(token.value);
  if (token.type === 'field') {
    const value = token.phrase ? quoteQueryValue(token.value) : token.value;
    return `${token.field}:${value}`;
  }
  if (token.type === 'operator') return token.value;
  if (token.type === 'not') return '-';
  if (token.type === 'lparen') return '(';
  return ')';
}

class MonitorQueryParser {
  private index = 0;

  constructor(private readonly tokens: QueryToken[]) {}

  public parse(): MonitorQueryNode {
    return this.parseOr() ?? { type: 'all' };
  }

  private parseOr(): MonitorQueryNode | null {
    const children: MonitorQueryNode[] = [];
    const first = this.parseAnd();
    if (first) children.push(first);

    while (this.matchOperator('OR')) {
      const next = this.parseAnd();
      if (next) children.push(next);
    }

    return this.combine('or', children);
  }

  private parseAnd(): MonitorQueryNode | null {
    const children: MonitorQueryNode[] = [];

    while (!this.isAtEnd() && !this.isRparen() && !this.isOperator('OR')) {
      if (this.matchOperator('AND')) continue;

      const next = this.parseUnary();
      if (next) {
        children.push(next);
        continue;
      }

      this.index += 1;
    }

    return this.combine('and', children);
  }

  private parseUnary(): MonitorQueryNode | null {
    if (this.match('not')) {
      const child = this.parseUnary() ?? { type: 'all' };
      return { type: 'not', child };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): MonitorQueryNode | null {
    const token = this.peek();
    if (!token) return null;

    if (token.type === 'lparen') {
      this.index += 1;
      const expression = this.parseOr();
      if (this.isRparen()) this.index += 1;
      return expression;
    }

    if (token.type === 'word' || token.type === 'phrase') {
      this.index += 1;
      return { type: 'term', value: token.value, phrase: token.type === 'phrase', field: 'body' };
    }

    if (token.type === 'field') {
      this.index += 1;
      return this.createFieldNode(token);
    }

    return null;
  }

  private createFieldNode(token: FieldToken): MonitorQueryNode {
    const field = FIELD_ALIASES[token.field];

    if (field === 'allintitle') {
      const terms = this.collectAllInTitleTerms(token);
      return terms.length > 0 ? { type: 'allintitle', terms } : { type: 'all' };
    }

    if (field === 'after' || field === 'before' || field === 'when') {
      return { type: 'date', field, value: token.value };
    }

    if (field === 'hl' || field === 'gl' || field === 'ceid') {
      return { type: 'metadata' };
    }

    return { type: 'term', value: token.value, phrase: token.phrase, field };
  }

  private collectAllInTitleTerms(token: FieldToken): Array<{ value: string; phrase: boolean }> {
    const terms = token.value ? [{ value: token.value, phrase: token.phrase }] : [];

    while (!this.isAtEnd()) {
      const next = this.peek();
      if (!next || next.type === 'field' || next.type === 'lparen' || next.type === 'rparen' || next.type === 'not') break;
      if (next.type === 'operator') break;

      if (next.type === 'word' || next.type === 'phrase') {
        terms.push({ value: next.value, phrase: next.type === 'phrase' });
        this.index += 1;
        continue;
      }

      break;
    }

    return terms;
  }

  private combine(type: 'and' | 'or', children: MonitorQueryNode[]): MonitorQueryNode | null {
    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    return { type, children };
  }

  private match(type: QueryToken['type']): boolean {
    const token = this.peek();
    if (token?.type !== type) return false;
    this.index += 1;
    return true;
  }

  private matchOperator(value: 'AND' | 'OR'): boolean {
    if (!this.isOperator(value)) return false;
    this.index += 1;
    return true;
  }

  private isOperator(value: 'AND' | 'OR'): boolean {
    const token = this.peek();
    return token?.type === 'operator' && token.value === value;
  }

  private isRparen(): boolean {
    return this.peek()?.type === 'rparen';
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private peek(): QueryToken | undefined {
    return this.tokens[this.index];
  }
}

function getUrlHost(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function containsSearchTerm(text: string, value: string, phrase: boolean): boolean {
  const normalizedText = normalizeSearchText(text);
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return true;

  if (phrase || normalizedValue.includes(' ')) {
    return normalizedText.includes(normalizedValue);
  }

  const expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedValue)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  return expression.test(normalizedText);
}

function matchesSite(item: NewsItem, value: string): boolean {
  const wantedDomain = value
    .toLocaleLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.trim();
  if (!wantedDomain) return true;

  const host = getUrlHost(item.link);
  if (host === wantedDomain || host.endsWith(`.${wantedDomain}`)) return true;

  const sourceHost = item.sourceUrl ? getUrlHost(item.sourceUrl) : '';
  if (sourceHost === wantedDomain || sourceHost.endsWith(`.${wantedDomain}`)) return true;

  return `${item.link} ${item.sourceUrl || ''}`.toLocaleLowerCase().includes(wantedDomain);
}

function parseDateFilter(value: string, endOfDay: boolean): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed.getTime();
}

function parseWhenDuration(value: string): number | null {
  const match = value.trim().match(/^(\d+)(h|d|w|m|y)$/i);
  if (!match?.[1] || !match[2]) return null;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLocaleLowerCase();
  const multipliers: Record<string, number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[unit] ?? 0);
}

function evaluateDateNode(node: Extract<TextQueryNode, { type: 'date' }>, item: NewsItem, now: Date): boolean {
  const itemTime = item.pubDate.getTime();
  if (Number.isNaN(itemTime)) return false;

  if (node.field === 'after') {
    const threshold = parseDateFilter(node.value, false);
    return threshold === null ? false : itemTime >= threshold;
  }

  if (node.field === 'before') {
    const threshold = parseDateFilter(node.value, true);
    return threshold === null ? false : itemTime <= threshold;
  }

  const durationMs = parseWhenDuration(node.value);
  return durationMs === null ? false : itemTime >= now.getTime() - durationMs;
}

function evaluateNode(node: MonitorQueryNode, item: NewsItem, now: Date): boolean {
  switch (node.type) {
    case 'all':
    case 'metadata':
      return true;
    case 'and':
      return node.children.every((child) => evaluateNode(child, item, now));
    case 'or':
      return node.children.some((child) => evaluateNode(child, item, now));
    case 'not':
      return !evaluateNode(node.child, item, now);
    case 'term': {
      if (node.field === 'site') return matchesSite(item, node.value);
      if (node.field === 'url') return containsSearchTerm(item.link, node.value, node.phrase);
      if (node.field === 'title') return containsSearchTerm(item.title, node.value, node.phrase);
      return containsSearchTerm(`${item.title} ${item.snippet || ''}`, node.value, node.phrase);
    }
    case 'allintitle':
      return node.terms.every((term) => containsSearchTerm(item.title, term.value, term.phrase));
    case 'date':
      return evaluateDateNode(node, item, now);
  }
}

export function compileMonitorQuery(query: string): CompiledMonitorQuery {
  const raw = query.trim();
  const parser = new MonitorQueryParser(tokenizeMonitorQuery(raw));
  return {
    raw,
    ast: parser.parse(),
  };
}

export function matchesCompiledMonitorQuery(
  query: CompiledMonitorQuery,
  item: NewsItem,
  now: Date = new Date(),
): boolean {
  if (!query.raw) return false;
  return evaluateNode(query.ast, item, now);
}

export function getMonitorRuleText(monitor: Monitor): string {
  const query = monitor.query?.trim();
  if (query) return query;
  return monitor.keywords.filter(Boolean).join(' OR ');
}

export function getMonitorDisplayRule(monitor: Monitor): string {
  return monitor.query?.trim() || monitor.keywords.filter(Boolean).join(', ');
}

export function extractMonitorKeywords(query: string): string[] {
  const keywords: string[] = [];
  let skipNext = false;

  for (const token of tokenizeMonitorQuery(query)) {
    if (token.type === 'not') {
      skipNext = true;
      continue;
    }

    if (skipNext) {
      if (token.type === 'word' || token.type === 'phrase' || token.type === 'field') {
        skipNext = false;
      }
      continue;
    }

    if (token.type === 'word' || token.type === 'phrase') {
      keywords.push(normalizeSearchText(token.value));
      continue;
    }

    if (token.type === 'field') {
      const field = FIELD_ALIASES[token.field];
      if (field === 'title' || field === 'url' || field === 'allintitle') {
        keywords.push(normalizeSearchText(token.value));
      }
    }
  }

  return Array.from(new Set(keywords.filter(Boolean)));
}

export function getMonitorGoogleNewsSearch(query: string): MonitorGoogleNewsSearch {
  const parts: string[] = [];
  const options: MonitorGoogleNewsSearch = {
    query: '',
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  };

  for (const token of tokenizeMonitorQuery(query)) {
    if (token.type === 'field') {
      if (token.field === 'hl') {
        options.hl = token.value || options.hl;
        continue;
      }
      if (token.field === 'gl') {
        options.gl = token.value || options.gl;
        continue;
      }
      if (token.field === 'ceid') {
        options.ceid = token.value || options.ceid;
        continue;
      }
    }

    const serialized = serializeQueryToken(token);
    if (serialized) parts.push(serialized);
  }

  options.query = parts
    .join(' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/-\s+/g, '-')
    .trim();

  return options;
}
