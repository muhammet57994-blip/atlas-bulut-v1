# ATLAS salt okunur yedek önizlemesi

Tarih: 2026-11-08  
Canlı adres: https://atlas-pasam-v1.pages.dev  
Cloudflare Worker sürümü: `ad51f2ed-f4df-44f6-936b-599c5d8cbd2f`

## Eklenenler

- Araçlar → Kayıtlar, listeler ve yedekler → Yedekler bölümünde ATLAS JSON dosyası seçilip **Dosyayı doğrula ve önizle** düğmesiyle incelenebilir.
- Dosya içeriği seçilen tarayıcıda doğrulanır. Bu işlev dosyayı sunucuya, Gemini’ye veya başka bir hizmete göndermez.
- Desteklenen ATLAS JSON sürümü, 4 MiB sınırı, üst bilgi, alan izin listeleri, grup başına kayıt sınırları, sayım bilgileri, yinelenen kimlikler, güvenli tamsayılar, liste/rutin alt yapıları ve ödeme bağlantıları kontrol edilir.
- Ekranda yalnızca yedek tarihi ve grup başına sayılar gösterilir; yedek içindeki kişisel metinler gösterilmez.
- Kayıt grupları önizlemede Türkçe ve kullanıcı dostu adlarla gösterilir.
- CSV/ICS ve tanınmayan JSON dosyaları reddedilir. Bu önizleme mevcut bulut kayıtlarını karşılaştırmaz ve herhangi bir kayıt eklemez, değiştirmez ya da geri yüklemez.

## Canlı doğrulama

- `/`: 200 HTML
- `/backup-preview.js`: 200 JavaScript
- `/backup-preview.css`: 200 CSS
- `/api/session`: 200 JSON
- Oturumsuz `/api/chat`: 401 (beklenen kimlik doğrulama koruması)
- Chrome’da Yedekler paneli ve dosyasız durum mesajı doğrulandı.
- Önizleme 390×844 ve 320×720 mobil ölçülerinde yatay taşma yapmadı.
- Dosya seçilmeden çalıştırıldığında açıklayıcı uyarı veriyor; ağ çağrısı yapılmıyor.
- En son tam test paketi 563/563 geçti. Yayın paketi 32 statik dosya içerdi.
- Son yayından sonra ana sayfa, `/organize.js` ve `/api/session` canlı Pages adresinde 200 döndü; servis hazır.
- En güncel Worker sürümü otomatik mikrofon başlangıcını kapatır; ayrıntı için [VOICE-PRIVACY-RELEASE.md](VOICE-PRIVACY-RELEASE.md).

## Sınırlar

Geri yükleme/ithal etme, var olan kayıtlarla çakışma karşılaştırması ve geri alma hâlâ desteklenmiyor. Ayrı yazma özelliği güvenli biçimde tasarlanmalıdır; gereksinimler [RESTORE-DESIGN.md](RESTORE-DESIGN.md) belgesindedir. Bu yayında üretim kayıtlarına yazılmadı.
