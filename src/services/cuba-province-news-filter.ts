export interface CubaProvinceNewsFilter {
  id: string;
  label: string;
  names: string[];
  demonyms: string[];
}

interface CompiledProvinceNewsFilter extends CubaProvinceNewsFilter {
  patterns: RegExp[];
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeProvinceNewsText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compileProvincePattern = (term: string): RegExp => {
  const normalized = normalizeProvinceNewsText(term);
  const pattern = normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => escapeRegExp(part))
    .join('\\s+');

  return new RegExp(`(^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, 'i');
};

const buildProvinceFilter = (filter: CubaProvinceNewsFilter): CompiledProvinceNewsFilter => {
  const allTerms = [...filter.names, ...filter.demonyms];
  const normalizedUniqueTerms = Array.from(new Set(allTerms.map(normalizeProvinceNewsText).filter(Boolean)));

  return {
    ...filter,
    patterns: normalizedUniqueTerms.map(compileProvincePattern),
  };
};

const CUBA_PROVINCE_FILTER_LIST: CompiledProvinceNewsFilter[] = [
  buildProvinceFilter({
    id: 'pinar-del-rio',
    label: 'Pinar del Rio',
    names: ['Pinar del Rio', 'Pinar del Río'],
    demonyms: ['pinareño', 'pinareña', 'pinareños', 'pinareñas'],
  }),
  buildProvinceFilter({
    id: 'artemisa',
    label: 'Artemisa',
    names: ['Artemisa'],
    demonyms: ['artemiseño', 'artemiseña', 'artemiseños', 'artemiseñas'],
  }),
  buildProvinceFilter({
    id: 'la-habana',
    label: 'La Habana',
    names: ['La Habana', 'Havana'],
    demonyms: ['habanero', 'habanera', 'habaneros', 'habaneras', 'havanan', 'havanans'],
  }),
  buildProvinceFilter({
    id: 'mayabeque',
    label: 'Mayabeque',
    names: ['Mayabeque'],
    demonyms: ['mayabequense', 'mayabequenses'],
  }),
  buildProvinceFilter({
    id: 'matanzas',
    label: 'Matanzas',
    names: ['Matanzas'],
    demonyms: ['matancero', 'matancera', 'matanceros', 'matanceras'],
  }),
  buildProvinceFilter({
    id: 'cienfuegos',
    label: 'Cienfuegos',
    names: ['Cienfuegos'],
    demonyms: ['cienfueguero', 'cienfueguera', 'cienfuegueros', 'cienfuegueras'],
  }),
  buildProvinceFilter({
    id: 'villa-clara',
    label: 'Villa Clara',
    names: ['Villa Clara'],
    demonyms: ['villaclareño', 'villaclareña', 'villaclareños', 'villaclareñas'],
  }),
  buildProvinceFilter({
    id: 'sancti-spiritus',
    label: 'Sancti Spiritus',
    names: ['Sancti Spiritus', 'Sancti Spíritus'],
    demonyms: ['espirituano', 'espirituana', 'espirituanos', 'espirituanas'],
  }),
  buildProvinceFilter({
    id: 'ciego-de-avila',
    label: 'Ciego de Avila',
    names: ['Ciego de Avila', 'Ciego de Ávila'],
    demonyms: ['avileño', 'avileña', 'avileños', 'avileñas', 'ciegoavileño', 'ciegoavileña', 'ciegoavileños', 'ciegoavileñas'],
  }),
  buildProvinceFilter({
    id: 'camaguey',
    label: 'Camaguey',
    names: ['Camaguey', 'Camagüey'],
    demonyms: ['camagueyano', 'camagueyana', 'camagueyanos', 'camagueyanas'],
  }),
  buildProvinceFilter({
    id: 'las-tunas',
    label: 'Las Tunas',
    names: ['Las Tunas'],
    demonyms: ['tunero', 'tunera', 'tuneros', 'tuneras', 'tunense', 'tunenses'],
  }),
  buildProvinceFilter({
    id: 'granma',
    label: 'Granma',
    names: ['Granma'],
    demonyms: ['granmense', 'granmenses'],
  }),
  buildProvinceFilter({
    id: 'holguin',
    label: 'Holguin',
    names: ['Holguin', 'Holguín'],
    demonyms: ['holguinero', 'holguinera', 'holguineros', 'holguineras'],
  }),
  buildProvinceFilter({
    id: 'santiago-de-cuba',
    label: 'Santiago de Cuba',
    names: ['Santiago de Cuba'],
    demonyms: ['santiaguero', 'santiaguera', 'santiagueros', 'santiagueras'],
  }),
  buildProvinceFilter({
    id: 'guantanamo',
    label: 'Guantanamo',
    names: ['Guantanamo', 'Guantánamo'],
    demonyms: ['guantanamero', 'guantanamera', 'guantanameros', 'guantanameras'],
  }),
  buildProvinceFilter({
    id: 'isla-de-la-juventud',
    label: 'Isla de la Juventud',
    names: ['Isla de la Juventud', 'Isle of Youth'],
    demonyms: ['pinero', 'pinera', 'pineros', 'pineras'],
  }),
];

export const CUBA_PROVINCE_NEWS_FILTERS: Record<string, CubaProvinceNewsFilter> = Object.fromEntries(
  CUBA_PROVINCE_FILTER_LIST.map(({ patterns: _patterns, ...filter }) => [filter.id, filter]),
);

const CUBA_PROVINCE_NEWS_FILTER_LOOKUP: Record<string, CompiledProvinceNewsFilter> = Object.fromEntries(
  CUBA_PROVINCE_FILTER_LIST.map((filter) => [filter.id, filter]),
);

export function findCubaProvinceNewsFilterById(id: string): CubaProvinceNewsFilter | null {
  return CUBA_PROVINCE_NEWS_FILTERS[id] ?? null;
}

export function matchesCubaProvinceNewsText(
  filterOrId: CubaProvinceNewsFilter | string,
  text: string,
): boolean {
  const filter = typeof filterOrId === 'string'
    ? CUBA_PROVINCE_NEWS_FILTER_LOOKUP[filterOrId]
    : CUBA_PROVINCE_NEWS_FILTER_LOOKUP[filterOrId.id];

  if (!filter) return false;

  const haystack = normalizeProvinceNewsText(text);
  if (!haystack) return false;

  return filter.patterns.some((pattern) => pattern.test(haystack));
}
