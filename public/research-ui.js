(() => {
  const mode = document.getElementById('assistantMode');
  const label = document.querySelector('.model-label');
  const hint = document.getElementById('modePrivacy');

  if (!mode) return;

  try {
    const saved = window.sessionStorage.getItem('atlas-assistant-mode');
    if (['chat', 'research', 'coding'].includes(saved)) mode.value = saved;
  } catch {}

  mode.addEventListener('change', () => {
    try { window.sessionStorage.setItem('atlas-assistant-mode', mode.value); } catch {}
    if (label) label.textContent = mode.value === 'research' ? 'ATLAS · Kaynaklı araştırma' : mode.value === 'coding' ? 'ATLAS · Kodlama desteği' : 'ATLAS · Yakın arkadaş';
    if (hint) hint.textContent = mode.value === 'research'
      ? 'Bu mesaj web’de aranır; yanıt Google Search sonuçlarına ve aşağıdaki kaynaklara dayanır.'
      : mode.value === 'coding'
        ? 'Kod örneği ve hata çözümlemesi alırsınız. ATLAS dosyaları değiştirmez veya kodu çalıştırmaz.'
        : 'Web araması yalnızca araştırma modu seçilince kullanılır. Hassas bilgi göndermeyin.';
  });

  window.atlasResearchMode = () => mode.value === 'research';
  window.atlasCodingMode = () => mode.value === 'coding';

  window.renderResearchSources = (article, sources, citations = []) => {
    if (!Array.isArray(sources) || !sources.length) return;
    const section = document.createElement('section');
    section.className = 'research-sources';
    const title = document.createElement('h4');
    title.textContent = 'Kaynaklar';
    const list = document.createElement('ol');
    for (const [index, source] of sources.entries()) {
      if (typeof source?.url !== 'string' || typeof source?.title !== 'string') continue;
      let url;
      try { url = new URL(source.url); } catch { continue; }
      if (url.protocol !== 'https:') continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title;
      item.append(link);
      if (citations.some(citation => citation.sourceIndices?.includes(index))) {
        const label = document.createElement('span');
        label.className = 'source-citation-label';
        label.textContent = ' Yanıtta kullanıldı';
        item.append(label);
      }
      list.append(item);
    }
    if (!list.children.length) return;
    section.append(title, list);
    article.append(section);
  };
})();
