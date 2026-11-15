// Категории бизнеса для поиска в OpenStreetMap. Фильтры — синтаксис Overpass QL.
// "kind" влияет на проверки аудита (например, меню и бронь для общепита).

export type CategoryKind = "food" | "beauty" | "health" | "retail" | "service" | "hospitality" | "other";

export const CATEGORIES: Record<string, { label: string; filters: string[]; kind: CategoryKind }> = {
  cafe: { label: "Кофейни и кафе", filters: ['["amenity"="cafe"]'], kind: "food" },
  restaurant: { label: "Рестораны", filters: ['["amenity"="restaurant"]'], kind: "food" },
  fast_food: { label: "Фастфуд и стритфуд", filters: ['["amenity"="fast_food"]'], kind: "food" },
  bar: { label: "Бары и пабы", filters: ['["amenity"~"^(bar|pub)$"]'], kind: "food" },
  bakery: { label: "Пекарни и кондитерские", filters: ['["shop"~"^(bakery|confectionery|pastry)$"]'], kind: "food" },
  beauty: { label: "Салоны красоты и барбершопы", filters: ['["shop"~"^(beauty|hairdresser|cosmetics)$"]'], kind: "beauty" },
  dentist: { label: "Стоматологии", filters: ['["amenity"="dentist"]', '["healthcare"="dentist"]'], kind: "health" },
  clinic: { label: "Клиники и медцентры", filters: ['["amenity"~"^(clinic|doctors)$"]'], kind: "health" },
  veterinary: { label: "Ветклиники и зоомагазины", filters: ['["amenity"="veterinary"]', '["shop"="pet"]'], kind: "health" },
  fitness: { label: "Фитнес и спорт", filters: ['["leisure"~"^(fitness_centre|sports_centre)$"]'], kind: "service" },
  hotel: { label: "Отели, хостелы, гостевые дома", filters: ['["tourism"~"^(hotel|hostel|guest_house|apartment)$"]'], kind: "hospitality" },
  florist: { label: "Цветочные магазины", filters: ['["shop"="florist"]'], kind: "retail" },
  clothes: { label: "Магазины одежды и обуви", filters: ['["shop"~"^(clothes|shoes|boutique)$"]'], kind: "retail" },
  furniture: { label: "Мебель и интерьер", filters: ['["shop"~"^(furniture|interior_decoration|kitchen)$"]'], kind: "retail" },
  car_service: { label: "Автосервисы и мойки", filters: ['["shop"~"^(car_repair|tyres)$"]', '["amenity"="car_wash"]'], kind: "service" },
  real_estate: { label: "Агентства недвижимости", filters: ['["office"="estate_agent"]'], kind: "service" },
  lawyer: { label: "Юристы и нотариусы", filters: ['["office"~"^(lawyer|notary)$"]'], kind: "service" },
  education: { label: "Курсы и языковые школы", filters: ['["amenity"~"^(language_school|driving_school|music_school)$"]', '["office"="educational_institution"]'], kind: "service" },
};

export type CategoryKey = keyof typeof CATEGORIES;

/** Пользовательский фильтр вида key=value или key~regex — проверяем строго, чтобы не допустить инъекции в Overpass QL. */
export function customFilter(raw: string): string | null {
  const m = raw.trim().match(/^([a-z_:]{1,40})\s*(=|~)\s*([\p{L}\p{N}_ |^$().-]{1,80})$/u);
  if (!m) return null;
  const value = m[3].trim();
  if (/["\\\]\[]/.test(value)) return null;
  return `["${m[1]}"${m[2]}"${value}"]`;
}

export function categoryKind(key: string): CategoryKind {
  return CATEGORIES[key]?.kind ?? "other";
}
