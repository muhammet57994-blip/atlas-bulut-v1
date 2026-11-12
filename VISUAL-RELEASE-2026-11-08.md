# ATLAS ana ekran görsel iyileştirmesi

Tarih: 2026-11-08  
Canlı adres: https://atlas-pasam-v1.pages.dev  
Worker sürümü: `b49b15f3-f0fc-4ce7-ac3a-53fe3b0ba803`

## Görsel değişiklikler

- Ana ekrandaki durum metni RGB temaya uygun, yüksek kontrastlı bir durum rozeti oldu.
- Dinamik nokta; hazır, dinleme, düşünme ve konuşma durumlarında renk değiştiriyor.
- “Atlas” ile uyandır eylemi belirgin ikincil düğme olarak düzenlendi; klavye odağı daha görünür.
- Alt bilgilendirme metni okunabilir bir yüzeye taşındı; dar ekranlarda satırlar sarılıyor.
- Kısa masaüstü pencerelerinde ana daire küçülüyor; konuşma, uyandırma ve favori eylemleri ilk görünümde kalıyor.
- Mevcut koyu arka plan, RGB halka ve hareket azaltma tercihleri korunuyor.
- Araçlar menüsündeki 14 seçenek simgeli, renk vurgulu kartlara dönüştürüldü; çok dar ekranlarda tek sütun kullanılıyor.

## Canlı görsel kontrol

- Chrome’da `1397×607` görünümünde ana sayfa açıldı.
- Durum rozeti, iki ses eylemi ve üç favori kısayol ekranda görünür durumda.
- Konuşma/mikrofon akışı başlatılmadı.
- `GET /` ve `GET /style.css`: `200`.
- Araçlar penceresi Chrome’da açılarak simgeli kartların ve klavye odağının canlı görünümü kontrol edildi.
- Worker yayın paketi kuru kontrolü başarılı.

