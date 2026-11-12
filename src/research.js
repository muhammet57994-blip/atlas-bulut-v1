const MAX_SOURCES = 5;
const MAX_TITLE = 180;
const MAX_URL = 2048;

export function normalizeResearchResults(metadata) {
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const supports = Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : [];
  const sources = [];
  const sourceIndexByUrl = new Map();
  const sourceIndexByChunk = new Map();

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const web = chunk?.web;
    if (typeof web?.uri !== 'string' || typeof web?.title !== 'string') continue;
    try {
      const url = new URL(web.uri);
      if (url.protocol !== 'https:' || !url.hostname || url.href.length > MAX_URL) continue;
      const existingIndex = sourceIndexByUrl.get(url.href);
      if (existingIndex !== undefined) {
        sourceIndexByChunk.set(chunkIndex, existingIndex);
        continue;
      }
      if (sources.length === MAX_SOURCES) continue;
      const sourceIndex = sources.length;
      sourceIndexByUrl.set(url.href, sourceIndex);
      sourceIndexByChunk.set(chunkIndex, sourceIndex);
      sources.push({title: web.title.slice(0, MAX_TITLE), url: url.href});
    } catch {}
  }

  const citations = supports.flatMap(support => {
    const segment = support?.segment;
    if (!Number.isInteger(segment?.startIndex) || !Number.isInteger(segment?.endIndex) || segment.startIndex < 0 || segment.endIndex < segment.startIndex) return [];
    const sourceIndices = [...new Set((support.groundingChunkIndices || [])
      .map(index => Number.isInteger(index) ? sourceIndexByChunk.get(index) : undefined)
      .filter(Number.isInteger))];
    return sourceIndices.length ? [{startIndex: segment.startIndex, endIndex: segment.endIndex, sourceIndices}] : [];
  }).slice(0, 40);

  return {sources, citations};
}

export function researchRequest(text) {
  return typeof text === 'string' && /(?:araştır|araştir|web(?:'de|de)? ara|internette ara|kaynakları bul|güncel bilgi)/iu.test(text);
}

export function codeRequest(text) {
  return typeof text === 'string' && /(?:kod yaz|kodla|kodlama|hata ayıkla|debug|implement(?:e|asyon)|fonksiyon yaz|bileşen yaz|script yaz|programla)/iu.test(text);
}

export function webSearchTool() {
  return {googleSearch: {}};
}
