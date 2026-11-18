/**
 * Sources feed an autocomplete from a client of `@open-geocode/client`.
 * There is one for the og client and one for each vendor client, since each speaks its own API.
 * Each turns that API's suggestions into one small shape a renderer can draw,
 * and keeps the API's own object beside it in `raw`.
 */

/** A point on the map. */
export interface Position {
  lat: number;
  lon: number;
}

/** One suggestion, whichever API it came from. */
export interface Suggestion<Raw = unknown, Place = unknown> {
  /** The ID to look the suggestion up by. `null` when the API gives none. */
  id: string | null;
  /** The text to show. */
  label: string;
  /** `null` when the API suggests without coordinates, until {@link Source.resolve} has fetched them. */
  location: Position | null;
  /** The suggestion as the API sent it. */
  raw: Raw;
  /** The place `resolve` fetched for the suggestion, as the API sent it. */
  place?: Place;
}

/** What a source gives. Spread it into `createAutocomplete`'s options. */
export interface Source<Item> {
  getItems(query: string, context: { signal: AbortSignal }): Promise<Item[]>;
  getItemLabel(item: Item): string;
  /**
   * The picked suggestion with its coordinates. Some APIs suggest without them, and for
   * those this looks the suggestion up by its ID. Call it from `onSelect`.
   */
  resolve(item: Item): Promise<Item>;
}

/** The request options a source passes with each keystroke. */
export interface SourceCall {
  signal?: AbortSignal;
}

/**
 * One session token for the keystrokes of a search and the lookup that ends it,
 * which an API that bills by session needs. A new one starts after each lookup.
 */
function sessions(): { current(): string; end(): string } {
  let session: string | undefined;
  const current = (): string => (session ??= globalThis.crypto.randomUUID());
  return {
    current,
    end() {
      const used = current();
      session = undefined;
      return used;
    },
  };
}

const getItemLabel = (item: Suggestion): string => item.label;

// og

/** What an og feature must have to become a suggestion. */
export interface OgFeature {
  geometry: { coordinates: number[] };
  properties: { id: string; label: string };
}
/** The part of the og client a source uses. `createClient()` from `@open-geocode/client` fits. */
export interface OgLike<P, F extends OgFeature> {
  autocomplete(params: P & { q: string }, options?: SourceCall): PromiseLike<{ features: F[] }>;
}

/**
 * Suggestions from the og client. og suggests with coordinates, so nothing is looked up on a pick.
 *
 * ```ts
 * createAutocomplete(ogSource(createClient({ baseUrl }), { limit: 5 }));
 * ```
 */
export function ogSource<P, F extends OgFeature>(
  client: OgLike<P, F>,
  params?: Omit<P, "q">,
): Source<Suggestion<F, never>> {
  return {
    async getItems(query, { signal }) {
      const answer = await client.autocomplete({ ...(params as P), q: query }, { signal });
      return answer.features.map((feature) => {
        const [lon, lat] = feature.geometry.coordinates;
        return {
          id: feature.properties.id,
          label: feature.properties.label,
          location: lon === undefined || lat === undefined ? null : { lat, lon },
          raw: feature,
        };
      });
    },
    getItemLabel,
    resolve: async (item) => item,
  };
}

// Google

/** What a Google suggestion must have to be drawn. */
export interface GoogleSuggestion {
  placePrediction?: { placeId?: string; text?: { text?: string } };
  queryPrediction?: { text?: { text?: string } };
}
/** What a Google place must have to give a suggestion its point. */
export interface GooglePlace {
  location?: { latitude?: number; longitude?: number };
}
/** The part of the Google client a source uses. `google()` from `@open-geocode/client/google` fits. */
export interface GoogleLike<
  P,
  S extends GoogleSuggestion,
  D extends GooglePlace,
  F extends string,
> {
  places: {
    autocomplete(
      params: P & { input: string; sessionToken?: string },
      options?: SourceCall,
    ): PromiseLike<{ suggestions?: S[] }>;
    get(params: { name: string; fieldMask: readonly F[]; sessionToken?: string }): PromiseLike<D>;
  };
}

/**
 * Suggestions from the Google client's `places.autocomplete`.
 * They carry no coordinates, so a pick is looked up with `places.get`, which fetches `fields`.
 * The default fields are the place's ID, location, address and name.
 */
export function googleSource<
  P,
  S extends GoogleSuggestion,
  D extends GooglePlace,
  F extends string,
>(
  client: GoogleLike<P, S, D, F>,
  params?: Omit<P, "input" | "sessionToken">,
  fields: readonly F[] = ["id", "location", "formattedAddress", "displayName"] as F[],
): Source<Suggestion<S, D>> {
  const session = sessions();
  return {
    async getItems(query, { signal }) {
      const answer = await client.places.autocomplete(
        { ...(params as P), input: query, sessionToken: session.current() },
        { signal },
      );
      return (answer.suggestions ?? []).map((suggestion) => ({
        id: suggestion.placePrediction?.placeId ?? null,
        label: (suggestion.placePrediction ?? suggestion.queryPrediction)?.text?.text ?? "",
        location: null,
        raw: suggestion,
      }));
    },
    getItemLabel,
    async resolve(item) {
      const sessionToken = session.end();
      if (item.id === null) return item;
      const place = await client.places.get({
        name: `places/${item.id}`,
        fieldMask: fields,
        sessionToken,
      });
      const { latitude, longitude } = place.location ?? {};
      return {
        ...item,
        location:
          latitude === undefined || longitude === undefined
            ? null
            : { lat: latitude, lon: longitude },
        place,
      };
    },
  };
}

// Mapbox

/** What a Mapbox suggestion must have to be drawn. */
export interface MapboxSuggestion {
  mapbox_id: string;
  name: string;
  full_address?: string;
  place_formatted?: string;
}
/** What a Mapbox feature must have to give a suggestion its point. */
export interface MapboxFeature {
  geometry: { coordinates: number[] };
}
/** The part of the Mapbox client a source uses. `mapbox()` from `@open-geocode/client/mapbox` fits. */
export interface MapboxLike<P, S extends MapboxSuggestion, F extends MapboxFeature> {
  searchbox: {
    suggest(
      params: P & { q: string; session_token: string },
      options?: SourceCall,
    ): PromiseLike<{ suggestions: S[] }>;
    retrieve(params: { id: string; session_token: string }): PromiseLike<{ features: F[] }>;
  };
}

/**
 * Suggestions from the Mapbox client's `searchbox.suggest`.
 * They carry no coordinates, so a pick is looked up with `searchbox.retrieve`.
 */
export function mapboxSource<P, S extends MapboxSuggestion, F extends MapboxFeature>(
  client: MapboxLike<P, S, F>,
  params?: Omit<P, "q" | "session_token">,
): Source<Suggestion<S, F>> {
  const session = sessions();
  return {
    async getItems(query, { signal }) {
      const answer = await client.searchbox.suggest(
        { ...(params as P), q: query, session_token: session.current() },
        { signal },
      );
      return answer.suggestions.map((suggestion) => {
        const where = suggestion.full_address ?? suggestion.place_formatted;
        return {
          id: suggestion.mapbox_id,
          // A full address already starts with the name.
          label:
            where === undefined || where.startsWith(suggestion.name)
              ? (where ?? suggestion.name)
              : `${suggestion.name}, ${where}`,
          location: null,
          raw: suggestion,
        };
      });
    },
    getItemLabel,
    async resolve(item) {
      const session_token = session.end();
      if (item.id === null) return item;
      const answer = await client.searchbox.retrieve({ id: item.id, session_token });
      const place = answer.features[0];
      if (place === undefined) return item;
      const [lon, lat] = place.geometry.coordinates;
      return {
        ...item,
        location: lon === undefined || lat === undefined ? null : { lat, lon },
        place,
      };
    },
  };
}

// HERE

/** What a HERE suggestion must have to be drawn. */
export interface HereSuggestion {
  id: string;
  title: string;
  address?: { label?: string };
}
/** What a HERE place must have to give a suggestion its point. */
export interface HerePlace {
  position?: { lat: number; lng: number };
}
/** The part of the HERE client a source uses. `here()` from `@open-geocode/client/here` fits. */
export interface HereLike<P, S extends HereSuggestion, D extends HerePlace> {
  autocomplete(params: P & { q: string }, options?: SourceCall): PromiseLike<{ items: S[] }>;
  lookup(params: { id: string }): PromiseLike<D>;
}

/**
 * Suggestions from the HERE client's `autocomplete`.
 * They carry no coordinates, so a pick is looked up with `lookup`.
 */
export function hereSource<P, S extends HereSuggestion, D extends HerePlace>(
  client: HereLike<P, S, D>,
  params?: Omit<P, "q">,
): Source<Suggestion<S, D>> {
  return {
    async getItems(query, { signal }) {
      const answer = await client.autocomplete({ ...(params as P), q: query }, { signal });
      return answer.items.map((item) => ({
        id: item.id,
        label: item.address?.label ?? item.title,
        location: null,
        raw: item,
      }));
    },
    getItemLabel,
    async resolve(item) {
      if (item.id === null) return item;
      const place = await client.lookup({ id: item.id });
      return {
        ...item,
        location: place.position ? { lat: place.position.lat, lon: place.position.lng } : null,
        place,
      };
    },
  };
}

// Precisely

/** What a Precisely prediction must have to become a suggestion. */
export interface PreciselyPrediction {
  prediction?: string;
  location?: { feature?: { geometry?: { coordinates?: number[] } } };
}
/** The part of the Precisely client a source uses. `precisely()` from `@open-geocode/client/precisely` fits. */
export interface PreciselyLike<P, S extends PreciselyPrediction> {
  autocomplete(
    params: P & { address: { addressLines: string[]; country: string } },
    options?: SourceCall,
  ): PromiseLike<{ response: { predictions?: S[] } }>;
}

/**
 * Suggestions from the Precisely client's `autocomplete`, for addresses in one `country`.
 * A prediction that carries its point needs no lookup on a pick.
 */
export function preciselySource<P, S extends PreciselyPrediction>(
  client: PreciselyLike<P, S>,
  country: string,
  params?: Omit<P, "address">,
): Source<Suggestion<S, never>> {
  return {
    async getItems(query, { signal }) {
      const answer = await client.autocomplete(
        { ...(params as P), address: { addressLines: [query], country } },
        { signal },
      );
      return (answer.response.predictions ?? []).map((prediction) => {
        const [lon, lat] = prediction.location?.feature?.geometry?.coordinates ?? [];
        return {
          id: null,
          label: prediction.prediction ?? "",
          location: lon === undefined || lat === undefined ? null : { lat, lon },
          raw: prediction,
        };
      });
    },
    getItemLabel,
    resolve: async (item) => item,
  };
}
