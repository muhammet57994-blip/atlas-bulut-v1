(() => {
  function appendText(container, text) {
    if (text) container.append(document.createTextNode(text));
  }

  function render(container, text) {
    container.replaceChildren();
    if (typeof text !== 'string') {
      container.textContent = String(text ?? '');
      return;
    }

    const fence = /```([^\r\n`]*)\r?\n([\s\S]*?)```/gu;
    let cursor = 0;
    let match;
    while ((match = fence.exec(text))) {
      appendText(container, text.slice(cursor, match.index));
      const codeText = match[2].replace(/\r?\n$/u, '');
      const block = document.createElement('div');
      block.className = 'code-block';
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';
      const language = document.createElement('span');
      language.className = 'code-language';
      language.textContent = match[1].trim().split(/\s+/u)[0] || 'Kod';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'code-copy';
      copy.textContent = 'Kodu kopyala';
      copy.addEventListener('click', async () => {
        try {
          const clipboard = window.navigator?.clipboard;
          if (!clipboard?.writeText) throw new Error('clipboard unavailable');
          await clipboard.writeText(codeText);
          copy.textContent = 'Kopyalandı';
        } catch {
          copy.textContent = 'Kopyalama başarısız';
        }
      });
      toolbar.append(language, copy);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeText;
      pre.append(code);
      block.append(toolbar, pre);
      container.append(block);
      cursor = fence.lastIndex;
    }
    appendText(container, text.slice(cursor));
  }

  window.AtlasCodeAssist = Object.freeze({render});
})();
