/** Какие типы контактов подходят каналу (синхронно с CHANNEL_CONTACT_TYPE на сервере). */
export const CHANNEL_CONTACT: Record<string, string[]> = { email: ["email"], telegram: ["telegram"], whatsapp: ["whatsapp", "phone"], linkedin: ["linkedin"] };
