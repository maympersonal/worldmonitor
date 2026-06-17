export interface CubaProvinceNewsFilter {
  id: string;
  label: string;
  names: string[];
  touristSites: string[];
  demonyms: string[];
}

interface CompiledProvinceNewsFilter extends CubaProvinceNewsFilter {
  namePatterns: RegExp[];
  touristSitePatterns: RegExp[];
  demonymPatterns: RegExp[];
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
  const nameTerms = Array.from(new Set(filter.names.map(normalizeProvinceNewsText).filter(Boolean)));
  const touristSiteTerms = Array.from(new Set(filter.touristSites.map(normalizeProvinceNewsText).filter(Boolean)));
  const demonymTerms = Array.from(new Set(filter.demonyms.map(normalizeProvinceNewsText).filter(Boolean)));
  const allTerms = [...nameTerms, ...touristSiteTerms, ...demonymTerms];
  const normalizedUniqueTerms = Array.from(new Set(allTerms.map(normalizeProvinceNewsText).filter(Boolean)));

  return {
    ...filter,
    namePatterns: nameTerms.map(compileProvincePattern),
    touristSitePatterns: touristSiteTerms.map(compileProvincePattern),
    demonymPatterns: demonymTerms.map(compileProvincePattern),
    patterns: normalizedUniqueTerms.map(compileProvincePattern),
  };
};

const CUBA_PROVINCE_TOURISM_TOPIC_TERMS = [
  'turismo',
  'turistico',
  'turistica',
  'turisticos',
  'turisticas',
  'turistas',
  'visitante',
  'visitantes',
  'viajero',
  'viajeros',
  'viaje',
  'viajes',
  'hotel',
  'hoteles',
  'resort',
  'hostal',
  'alojamiento',
  'playa',
  'playas',
  'cayo',
  'cayos',
  'destino',
  'destinos',
  'patrimonio',
  'unesco',
  'festival',
  'cultura',
  'cultural',
  'museo',
  'museos',
  'gastronomia',
  'ecoturismo',
  'naturaleza',
  'senderismo',
  'vuelo',
  'vuelos',
  'aeropuerto',
  'aerolinea',
  'aerolineas',
  'crucero',
  'cruceros',
  'marina',
  'excursion',
  'excursiones',
  'travel',
  'tourism',
  'tourist',
  'tourists',
  'visitor',
  'visitors',
  'traveler',
  'travelers',
  'hotel',
  'resort',
  'beach',
  'beaches',
  'destination',
  'destinations',
  'heritage',
  'flight',
  'flights',
  'airport',
  'airline',
  'airlines',
  'cruise',
  'cruises',
  'museum',
  'museums',
  'ecotourism',
  'eco tourism',
];

const CUBA_PROVINCE_TOURISM_TOPIC_PATTERNS = Array.from(
  new Set(CUBA_PROVINCE_TOURISM_TOPIC_TERMS.map(normalizeProvinceNewsText).filter(Boolean)),
).map(compileProvincePattern);

const CUBA_PROVINCE_FILTER_LIST: CompiledProvinceNewsFilter[] = [
  buildProvinceFilter({
    id: 'pinar-del-rio',
    label: 'Pinar del Rio',
    names: ['Pinar del Rio', 'Pinar del Río'],
    touristSites: ['Viñales', 'Vinales', 'Valle de Viñales', 'Valle de Vinales', 'Cayo Jutías', 'Cayo Jutias', 'Cayo Levisa', 'Soroa'],
    demonyms: ['pinareño', 'pinareña', 'pinareños', 'pinareñas'],
  }),
  buildProvinceFilter({
    id: 'artemisa',
    label: 'Artemisa',
    names: ['Artemisa'],
    touristSites: ['Soroa', 'Mariel', 'Las Terrazas', 'San Antonio de los Baños', 'San Antonio de los Banos'],
    demonyms: ['artemiseño', 'artemiseña', 'artemiseños', 'artemiseñas'],
  }),
  buildProvinceFilter({
    id: 'la-habana',
    label: 'La Habana',
    names: ['La Habana', 'Havana'],
    touristSites: ['Habana Vieja', 'Old Havana', 'Vedado', 'Malecon', 'Malecón', 'Playas del Este', 'Fusterlandia'],
    demonyms: ['habanero', 'habanera', 'habaneros', 'habaneras', 'havanan', 'havanans'],
  }),
  buildProvinceFilter({
    id: 'mayabeque',
    label: 'Mayabeque',
    names: ['Mayabeque'],
    touristSites: ['Jibacoa', 'Santa Cruz del Norte', 'Escaleras de Jaruco', 'Playa Jibacoa'],
    demonyms: ['mayabequense', 'mayabequenses'],
  }),
  buildProvinceFilter({
    id: 'matanzas',
    label: 'Matanzas',
    names: ['Matanzas'],
    touristSites: ['Varadero', 'Cienaga de Zapata', 'Ciénaga de Zapata', 'Bahía de Cochinos', 'Bay of Pigs', 'Playa Giron', 'Playa Girón'],
    demonyms: ['matancero', 'matancera', 'matanceros', 'matanceras'],
  }),
  buildProvinceFilter({
    id: 'cienfuegos',
    label: 'Cienfuegos',
    names: ['Cienfuegos'],
    touristSites: ['Punta Gorda', 'Jardín Botánico de Cienfuegos', 'Jardin Botanico de Cienfuegos', 'El Nicho', 'Bahía de Cienfuegos'],
    demonyms: ['cienfueguero', 'cienfueguera', 'cienfuegueros', 'cienfuegueras'],
  }),
  buildProvinceFilter({
    id: 'villa-clara',
    label: 'Villa Clara',
    names: ['Villa Clara', 'Santa Clara'],
    touristSites: ['Cayo Santa María', 'Cayo Santa Maria', 'Cayo Las Brujas', 'Cayo Ensenachos', 'Remedios'],
    demonyms: ['villaclareño', 'villaclareña', 'villaclareños', 'villaclareñas'],
  }),
  buildProvinceFilter({
    id: 'sancti-spiritus',
    label: 'Sancti Spiritus',
    names: ['Sancti Spiritus', 'Sancti Spíritus'],
    touristSites: ['Trinidad', 'Valle de los Ingenios', 'Topes de Collantes', 'Playa Ancón', 'Playa Ancon', 'Cayo Blanco'],
    demonyms: ['espirituano', 'espirituana', 'espirituanos', 'espirituanas'],
  }),
  buildProvinceFilter({
    id: 'ciego-de-avila',
    label: 'Ciego de Avila',
    names: ['Ciego de Avila', 'Ciego de Ávila'],
    touristSites: ['Cayo Coco', 'Cayo Guillermo', 'Jardines del Rey', 'Morón', 'Moron', 'Laguna de la Leche'],
    demonyms: ['avileño', 'avileña', 'avileños', 'avileñas', 'ciegoavileño', 'ciegoavileña', 'ciegoavileños', 'ciegoavileñas'],
  }),
  buildProvinceFilter({
    id: 'camaguey',
    label: 'Camaguey',
    names: ['Camaguey', 'Camagüey'],
    touristSites: ['Santa Lucía', 'Santa Lucia', 'Playa Santa Lucia', 'Nuevitas', 'Centro histórico de Camagüey', 'Centro historico de Camaguey'],
    demonyms: ['camagueyano', 'camagueyana', 'camagueyanos', 'camagueyanas'],
  }),
  buildProvinceFilter({
    id: 'las-tunas',
    label: 'Las Tunas',
    names: ['Las Tunas'],
    touristSites: ['Puerto Padre', 'Covarrubias', 'Playa Covarrubias', 'Chaparra'],
    demonyms: ['tunero', 'tunera', 'tuneros', 'tuneras', 'tunense', 'tunenses'],
  }),
  buildProvinceFilter({
    id: 'granma',
    label: 'Granma',
    names: ['Granma', 'Bayamo', 'Manzanillo'],
    touristSites: ['Sierra Maestra', 'Marea del Portillo', 'La Demajagua', 'Pilón', 'Pilon'],
    demonyms: ['granmense', 'granmenses'],
  }),
  buildProvinceFilter({
    id: 'holguin',
    label: 'Holguin',
    names: ['Holguin', 'Holguín'],
    touristSites: ['Guardalavaca', 'Playa Pesquero', 'Gibara', 'Banes', 'Cayo Saetía', 'Cayo Saetia', 'Bahía de Naranjo'],
    demonyms: ['holguinero', 'holguinera', 'holguineros', 'holguineras'],
  }),
  buildProvinceFilter({
    id: 'santiago-de-cuba',
    label: 'Santiago de Cuba',
    names: ['Santiago de Cuba'],
    touristSites: ['Castillo del Morro', 'Cementerio Santa Ifigenia', 'Gran Piedra', 'Parque Baconao', 'Carnaval de Santiago'],
    demonyms: ['santiaguero', 'santiaguera', 'santiagueros', 'santiagueras'],
  }),
  buildProvinceFilter({
    id: 'guantanamo',
    label: 'Guantanamo',
    names: ['Guantanamo', 'Guantánamo'],
    touristSites: ['Baracoa', 'Maisí', 'Maisi', 'Yunque de Baracoa', 'Alejandro de Humboldt', 'Playa Maguana'],
    demonyms: ['guantanamero', 'guantanamera', 'guantanameros', 'guantanameras'],
  }),
  buildProvinceFilter({
    id: 'isla-de-la-juventud',
    label: 'Isla de la Juventud',
    names: ['Isla de la Juventud', 'Isle of Youth', 'Nueva Gerona'],
    touristSites: ['Cayo Largo', 'Punta Frances', 'Punta Francés', 'Playa Bibijagua', 'Colony Hotel'],
    demonyms: ['pinero', 'pinera', 'pineros', 'pineras'],
  }),
];

export const CUBA_PROVINCE_NEWS_FILTERS: Record<string, CubaProvinceNewsFilter> = Object.fromEntries(
  CUBA_PROVINCE_FILTER_LIST.map(({
    namePatterns: _namePatterns,
    touristSitePatterns: _touristSitePatterns,
    demonymPatterns: _demonymPatterns,
    patterns: _patterns,
    ...filter
  }) => [filter.id, filter]),
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

export function matchesCubaTourismTopicText(text: string): boolean {
  const haystack = normalizeProvinceNewsText(text);
  if (!haystack) return false;
  return CUBA_PROVINCE_TOURISM_TOPIC_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function matchesCubaProvinceTourismNewsText(
  filterOrId: CubaProvinceNewsFilter | string,
  text: string,
): boolean {
  const filter = typeof filterOrId === 'string'
    ? CUBA_PROVINCE_NEWS_FILTER_LOOKUP[filterOrId]
    : CUBA_PROVINCE_NEWS_FILTER_LOOKUP[filterOrId.id];

  if (!filter) return false;

  const haystack = normalizeProvinceNewsText(text);
  if (!haystack) return false;

  const matchesProvinceOrDemonym = [...filter.namePatterns, ...filter.demonymPatterns]
    .some((pattern) => pattern.test(haystack));
  const matchesTouristSite = filter.touristSitePatterns.some((pattern) => pattern.test(haystack));

  if (!matchesProvinceOrDemonym && !matchesTouristSite) return false;
  if (matchesTouristSite) return true;

  return CUBA_PROVINCE_TOURISM_TOPIC_PATTERNS.some((pattern) => pattern.test(haystack));
}
