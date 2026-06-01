import type { FlightRoute, FlightRouteEndpoint, FlightRouteMarket } from '@/types';

const airports = {
  HAV: { iata: 'HAV', name: 'Jose Marti International', city: 'Havana', country: 'Cuba', lat: 22.9892, lon: -82.4091 },
  VRA: { iata: 'VRA', name: 'Juan Gualberto Gomez', city: 'Varadero', country: 'Cuba', lat: 23.0344, lon: -81.4353 },
  HOG: { iata: 'HOG', name: 'Frank Pais International', city: 'Holguin', country: 'Cuba', lat: 20.7856, lon: -76.3151 },
  CCC: { iata: 'CCC', name: 'Jardines del Rey', city: 'Cayo Coco', country: 'Cuba', lat: 22.4610, lon: -78.3284 },
  SCU: { iata: 'SCU', name: 'Antonio Maceo', city: 'Santiago de Cuba', country: 'Cuba', lat: 19.9698, lon: -75.8354 },
  MIA: { iata: 'MIA', name: 'Miami International', city: 'Miami', country: 'United States', lat: 25.7959, lon: -80.2870 },
  FLL: { iata: 'FLL', name: 'Fort Lauderdale-Hollywood International', city: 'Fort Lauderdale', country: 'United States', lat: 26.0726, lon: -80.1527 },
  TPA: { iata: 'TPA', name: 'Tampa International', city: 'Tampa', country: 'United States', lat: 27.9755, lon: -82.5332 },
  JFK: { iata: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'United States', lat: 40.6413, lon: -73.7781 },
  YYZ: { iata: 'YYZ', name: 'Toronto Pearson', city: 'Toronto', country: 'Canada', lat: 43.6777, lon: -79.6248 },
  YUL: { iata: 'YUL', name: 'Montreal-Trudeau', city: 'Montreal', country: 'Canada', lat: 45.4706, lon: -73.7408 },
  MAD: { iata: 'MAD', name: 'Adolfo Suarez Madrid-Barajas', city: 'Madrid', country: 'Spain', lat: 40.4983, lon: -3.5676 },
  CDG: { iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'France', lat: 49.0097, lon: 2.5479 },
  FRA: { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', lat: 50.0379, lon: 8.5622 },
  SVO: { iata: 'SVO', name: 'Sheremetyevo International', city: 'Moscow', country: 'Russia', lat: 55.9726, lon: 37.4146 },
  MEX: { iata: 'MEX', name: 'Mexico City International', city: 'Mexico City', country: 'Mexico', lat: 19.4363, lon: -99.0721 },
  CUN: { iata: 'CUN', name: 'Cancun International', city: 'Cancun', country: 'Mexico', lat: 21.0365, lon: -86.8771 },
  PTY: { iata: 'PTY', name: 'Tocumen International', city: 'Panama City', country: 'Panama', lat: 9.0714, lon: -79.3835 },
  BOG: { iata: 'BOG', name: 'El Dorado International', city: 'Bogota', country: 'Colombia', lat: 4.7016, lon: -74.1469 },
  CCS: { iata: 'CCS', name: 'Simon Bolivar International', city: 'Caracas', country: 'Venezuela', lat: 10.6031, lon: -66.9906 },
  SDQ: { iata: 'SDQ', name: 'Las Americas International', city: 'Santo Domingo', country: 'Dominican Republic', lat: 18.4297, lon: -69.6689 },
  NAS: { iata: 'NAS', name: 'Lynden Pindling International', city: 'Nassau', country: 'Bahamas', lat: 25.0390, lon: -77.4662 },
} satisfies Record<string, FlightRouteEndpoint>;

function route(
  origin: keyof typeof airports,
  destination: keyof typeof airports,
  market: FlightRouteMarket,
  priority: 1 | 2 | 3,
  note?: string
): FlightRoute {
  return {
    id: `${origin.toLowerCase()}-${destination.toLowerCase()}`,
    origin: airports[origin],
    destination: airports[destination],
    market,
    priority,
    note,
  };
}

export const CUBA_FLIGHT_ROUTES: FlightRoute[] = [
  route('MIA', 'HAV', 'us', 1, 'High-volume Cuba corridor'),
  route('FLL', 'HAV', 'us', 1, 'South Florida gateway'),
  route('TPA', 'HAV', 'us', 2, 'Florida-Cuba corridor'),
  route('JFK', 'HAV', 'us', 2, 'Northeast gateway'),
  route('YYZ', 'VRA', 'canada', 1, 'Canadian leisure corridor'),
  route('YUL', 'VRA', 'canada', 1, 'Quebec leisure corridor'),
  route('YYZ', 'CCC', 'canada', 2, 'Cayo Coco leisure corridor'),
  route('YUL', 'HOG', 'canada', 2, 'Eastern Cuba leisure corridor'),
  route('MAD', 'HAV', 'europe', 1, 'Europe-Cuba trunk route'),
  route('CDG', 'HAV', 'europe', 2, 'Western Europe gateway'),
  route('FRA', 'HOG', 'europe', 3, 'Long-haul leisure corridor'),
  route('SVO', 'VRA', 'europe', 3, 'Long-haul leisure corridor'),
  route('MEX', 'HAV', 'latin_america', 1, 'Mexico-Cuba connection'),
  route('CUN', 'HAV', 'latin_america', 2, 'Caribbean transfer corridor'),
  route('PTY', 'HAV', 'latin_america', 1, 'Latin America hub connection'),
  route('BOG', 'HAV', 'latin_america', 2, 'Andean connection'),
  route('CCS', 'HAV', 'latin_america', 2, 'Venezuela-Cuba corridor'),
  route('SDQ', 'SCU', 'caribbean', 3, 'Caribbean regional connection'),
  route('NAS', 'HAV', 'caribbean', 3, 'Caribbean regional connection'),
];

const routeAirports: Array<[string, FlightRouteEndpoint]> = CUBA_FLIGHT_ROUTES.flatMap(
  (routeItem): Array<[string, FlightRouteEndpoint]> => [
    [routeItem.origin.iata, routeItem.origin],
    [routeItem.destination.iata, routeItem.destination],
  ]
);

export const CUBA_FLIGHT_AIRPORTS: FlightRouteEndpoint[] = Array.from(
  new Map<string, FlightRouteEndpoint>(routeAirports).values()
);
