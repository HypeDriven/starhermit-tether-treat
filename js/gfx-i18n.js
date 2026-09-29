// gfx-i18n.js — strings for the Graphics settings section. The rest of the
// game ships in English only; this panel follows the browser language.

const EN = {
  graphics: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  fromPreset: 'From preset ({tier})',
  renderScale: 'Render scale',
  adaptive: 'Adaptive resolution',
  showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device, so the game renders without it.',
  noWebgl: 'WebGL is unavailable, so graphics options have no effect.',
  cat: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade',
    antialias: 'Anti-aliasing', particles: 'Particles', background: 'Background', detail: 'Detail',
  },
  tier: {
    low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium',
    off: 'Off', on: 'On', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Static', animated: 'Animated', plain: 'Plain', detailed: 'Detailed',
  },
  sum: {
    noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
    bloom: 'bloom', grade: 'colour grade', noAA: 'no anti-aliasing', plain: 'plain materials', detailed: 'detailed materials',
  },
};

const US = {
  ...EN,
  cat: { ...EN.cat, grade: 'Color grade' },
  sum: { ...EN.sum, grade: 'color grade' },
};

const ES = {
  graphics: 'Gráficos',
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  fromPreset: 'Según el ajuste ({tier})',
  renderScale: 'Escala de renderizado',
  adaptive: 'Resolución adaptativa',
  showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
  noWebgl: 'WebGL no está disponible, así que las opciones gráficas no tienen efecto.',
  cat: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Suavizado de bordes', particles: 'Partículas', background: 'Fondo', detail: 'Detalle',
  },
  tier: {
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sí', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Estático', animated: 'Animado', plain: 'Sencillo', detailed: 'Detallado',
  },
  sum: {
    noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa',
    bloom: 'resplandor', grade: 'corrección de color', noAA: 'sin suavizado', plain: 'materiales sencillos', detailed: 'materiales detallados',
  },
};

const ES_419 = { ...ES, renderScale: 'Escala de render' };

const DE = {
  graphics: 'Grafik',
  quality: 'Qualität',
  auto: 'Automatisch (erkannt: {tier})',
  fromPreset: 'Wie Voreinstellung ({tier})',
  renderScale: 'Renderskalierung',
  adaptive: 'Adaptive Auflösung',
  showFps: 'Bildrate anzeigen',
  postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spiel wird ohne sie dargestellt.',
  noWebgl: 'WebGL ist nicht verfügbar, daher haben die Grafikoptionen keine Wirkung.',
  cat: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', particles: 'Partikel', background: 'Hintergrund', detail: 'Details',
  },
  tier: {
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel',
    off: 'Aus', on: 'An', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Statisch', animated: 'Animiert', plain: 'Einfach', detailed: 'Detailliert',
  },
  sum: {
    noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoFull: 'volle Umgebungsverdeckung',
    bloom: 'Bloom', grade: 'Farbkorrektur', noAA: 'keine Kantenglättung', plain: 'einfache Materialien', detailed: 'detaillierte Materialien',
  },
};

const FR = {
  graphics: 'Graphismes',
  quality: 'Qualité',
  auto: 'Automatique (détectée : {tier})',
  fromPreset: 'Selon le préréglage ({tier})',
  renderScale: 'Échelle de rendu',
  adaptive: 'Résolution adaptative',
  showFps: 'Afficher la fréquence d’images',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; le jeu s’affiche sans lui.',
  noWebgl: 'WebGL est indisponible, les options graphiques sont donc sans effet.',
  cat: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', particles: 'Particules', background: 'Arrière-plan', detail: 'Détails',
  },
  tier: {
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyenne',
    off: 'Non', on: 'Oui', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Fixe', animated: 'Animé', plain: 'Simples', detailed: 'Détaillés',
  },
  sum: {
    noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète',
    bloom: 'halo lumineux', grade: 'étalonnage', noAA: 'sans anticrénelage', plain: 'matériaux simples', detailed: 'matériaux détaillés',
  },
};

const FR_CA = { ...FR, showFps: 'Afficher le nombre d’images par seconde' };

const PT = {
  graphics: 'Gráficos',
  quality: 'Qualidade',
  auto: 'Automática (detectada: {tier})',
  fromPreset: 'Conforme a predefinição ({tier})',
  renderScale: 'Escala de renderização',
  adaptive: 'Resolução adaptativa',
  showFps: 'Mostrar taxa de quadros',
  postFailed: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
  noWebgl: 'O WebGL não está disponível, então as opções gráficas não têm efeito.',
  cat: {
    shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Suavização de bordas', particles: 'Partículas', background: 'Fundo', detail: 'Detalhes',
  },
  tier: {
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média',
    off: 'Desligado', on: 'Ligado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Estático', animated: 'Animado', plain: 'Simples', detailed: 'Detalhado',
  },
  sum: {
    noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão de ambiente', aoFull: 'oclusão de ambiente completa',
    bloom: 'brilho', grade: 'correção de cor', noAA: 'sem suavização', plain: 'materiais simples', detailed: 'materiais detalhados',
  },
};

const IT = {
  graphics: 'Grafica',
  quality: 'Qualità',
  auto: 'Automatica (rilevata: {tier})',
  fromPreset: 'Dal preset ({tier})',
  renderScale: 'Scala di rendering',
  adaptive: 'Risoluzione adattiva',
  showFps: 'Mostra frequenza fotogrammi',
  postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; il gioco viene mostrato senza.',
  noWebgl: 'WebGL non è disponibile, quindi le opzioni grafiche non hanno effetto.',
  cat: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', particles: 'Particelle', background: 'Sfondo', detail: 'Dettagli',
  },
  tier: {
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sì', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    static: 'Statico', animated: 'Animato', plain: 'Semplici', detailed: 'Dettagliati',
  },
  sum: {
    noShadows: 'nessuna ombra', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoFull: 'occlusione ambientale completa',
    bloom: 'bagliore', grade: 'correzione colore', noAA: 'nessun antialiasing', plain: 'materiali semplici', detailed: 'materiali dettagliati',
  },
};

export const GFX_STRINGS = {
  'en-US': US, 'en-GB': EN, 'es-419': ES_419, 'es-ES': ES, 'de-DE': DE,
  'fr-FR': FR, 'fr-CA': FR_CA, 'pt-BR': PT, 'it-IT': IT,
};

const BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the closest supported locale for a BCP-47 tag (default en-US). */
export function pickLocale(tag) {
  const t = String(tag || '').trim();
  if (GFX_STRINGS[t]) return t;
  const lower = t.toLowerCase();
  for (const k of Object.keys(GFX_STRINGS)) if (k.toLowerCase() === lower) return k;
  if (/^es-es\b/i.test(t)) return 'es-ES';
  if (/^en-(gb|au|nz|ie|za|in)\b/i.test(t)) return 'en-GB';
  if (/^fr-ca\b/i.test(t)) return 'fr-CA';
  if (/^pt\b/i.test(t)) return 'pt-BR';
  return BY_LANG[lower.slice(0, 2)] || 'en-US';
}

export function gfxStrings(tag) {
  return GFX_STRINGS[pickLocale(tag !== undefined ? tag : (globalThis.navigator && navigator.language))];
}

export function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}

/** Localized version of gfx.describe(): the cost summary line. */
export function summaryText(r, pixels, S) {
  const shadowSize = { low: 1024, medium: 2048, high: 4096 }[r.shadows];
  const parts = [
    r.shadows === 'off' ? S.sum.noShadows : fmt(S.sum.shadows, { n: shadowSize }),
    r.ao === 'off' ? null : r.ao === 'high' ? S.sum.aoFull : S.sum.ao,
    r.bloom === 'on' ? S.sum.bloom : null,
    r.grade === 'on' ? S.sum.grade : null,
    r.antialias === 'off' ? S.sum.noAA : r.antialias.toUpperCase(),
    S.sum[r.detail],
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}
