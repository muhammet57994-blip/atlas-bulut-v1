# Araştırma kaynak atıfları — 8 Kasım 2026

Yayın: https://atlas-pasam-v1.pages.dev/  
Worker sürümü: `0d44997f-f12f-4c8a-95fd-efcd5f3e064e`

## Düzeltme

Araştırma yanıtındaki metin içi atıflar artık Google’ın özgün arama sonucu kimliklerinden ekranda gösterilen kaynak listesine doğru eşlenir. Geçersiz HTTPS dışı adresler, yinelenen bağlantılar ve sınırı aşan kaynaklar temizlenirken atıf numaraları kaymaz. Uzunluğu 2048 karakteri aşan URL’ler kırpılıp bozuk bağlantı üretmek yerine atıf listesinden çıkarılır.

Veritabanı şeması, kullanıcı kayıtları ve istemci dosyaları değişmedi. Yeni servis, model veya ücret eklenmedi.

## Doğrulama

- Toplam 547 otomatik test geçti; yeni testler geçersiz, yinelenen ve kaynak sınırını aşan sonuçlarda atıf eşlemesini ve araştırma API yanıtını kapsıyor.
- Worker yayın paketi kuru kontrolden geçti ve `0d44997f-f12f-4c8a-95fd-efcd5f3e064e` sürümü yayımlandı.
- Canlı oturum kontrolü `200` ve `ready:true` döndürdü. Girişsiz sohbet/ses çağrıları `401`, gizli ayar yolu `404` döndürdü; güvenlik başlıkları mevcut.
- Canlı `index.html`, `app.js`, `research-ui.js`, `style.css` ve `sw.js` dosyaları yerel kaynakla birebir eşleşiyor.
- Chrome’da 390×844 ve 320×720 mobil görünümlerinde yatay taşma görülmedi.
- `pnpm audit`: bilinen güvenlik açığı bulunmadı.

Araştırmanın gerçek sağlayıcı yanıtı Gemini/Google Search kotasına bağlıdır. Bu düzeltme, sağlayıcı kota uyarısını veya kaynakların doğruluğuna ilişkin kullanıcı değerlendirmesini değiştirmez.
