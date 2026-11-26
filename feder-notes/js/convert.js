// Handschrift → Formel (LaTeX) oder Text, erkannt von Claude (Bilderkennung).
// Der API-Schlüssel bleibt nur auf diesem Gerät (IndexedDB) und wird nicht synchronisiert.
import Anthropic from '../vendor/anthropic-sdk.js';
import { db } from './db.js';

const MODEL = 'claude-opus-5-5';

const PROMPTS = {
  formula: 'Das Bild zeigt eine handgeschriebene Formel aus dem Schulunterricht (Mathe, Physik oder Chemie). ' +
    'Gib sie exakt als LaTeX zurück (ohne $-Zeichen, ohne \\[ \\]), so wie sie geschrieben ist – nichts ausrechnen, nichts ergänzen. ' +
    'Chemische Formeln mit \\mathrm{} und tiefgestellten Zahlen (z. B. \\mathrm{H_2O}). ' +
    'Im Feld "text" dieselbe Formel als gut lesbarer Klartext (z. B. "a² + b² = c²"). ' +
    'Ist etwas unleserlich, nimm die wahrscheinlichste Lesart.',
  text: 'Das Bild zeigt deutsche Handschrift aus einer Schul-Mitschrift. Transkribiere sie wortgetreu ins Feld "text": ' +
    'Rechtschreibung so wie geschrieben, Zeilenumbrüche wie im Bild, Aufzählungszeichen als "- ". Nichts hinzufügen oder erklären.',
};

const SCHEMAS = {
  formula: {
    type: 'object',
    properties: { latex: { type: 'string' }, text: { type: 'string' } },
    required: ['latex', 'text'],
    additionalProperties: false,
  },
  text: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
};

export const getApiKey = () => db.getMeta('anthropicKey', '');
export const setApiKey = key => db.setMeta('anthropicKey', (key || '').trim());

/**
 * @param {'formula'|'text'} kind
 * @param {string} pngDataURL Bild der markierten Handschrift
 * @returns {Promise<{latex?: string, text: string}>}
 */
export async function recognize(kind, pngDataURL) {
  const apiKey = await getApiKey();
  if (!apiKey) throw Object.assign(new Error('Kein API-Schlüssel eingerichtet'), { code: 'nokey' });
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,          // Schlüssel gehört dem Nutzer und liegt nur auf seinem Gerät
    ...(window.__federApiBase ? { baseURL: window.__federApiBase } : {}),   // nur für automatische Tests
  });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[kind] } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngDataURL.split(',')[1] } },
          { type: 'text', text: PROMPTS[kind] },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API-Schlüssel ungültig – bitte in den Einstellungen prüfen');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('Der API-Schlüssel hat keinen Zugriff (Guthaben/Berechtigung prüfen)');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Zu viele Anfragen – bitte kurz warten');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Keine Internetverbindung zur Erkennung');
    if (err instanceof Anthropic.APIError) throw new Error(`Erkennung fehlgeschlagen (${err.status || 'Fehler'}): ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('Die Erkennung wurde abgelehnt.');
  const block = response.content.find(b => b.type === 'text');
  if (!block) throw new Error('Keine Antwort von der Erkennung');
  const out = JSON.parse(block.text);
  if (kind === 'formula') out.latex = String(out.latex || '').replace(/^\$+|\$+$/g, '').trim();
  return out;
}
