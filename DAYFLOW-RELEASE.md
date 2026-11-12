# Günlük denge ve çevrimdışı kayıtlar — 25 Ekim 2026

Yayın: https://atlas-pasam-v1.pages.dev/  
Bilgisayar: http://localhost:8790/  
Worker sürümü: `3bb81ddb-0aa4-4c1c-a2a8-95bcfd2df606`

## Davranış

- Günümü toparla, açık/gecikmiş/tarihsiz işlerden seçilen en fazla 10 işi gerçek ajanda boşluklarına yerleştirir. Normal randevular sabittir. Süre ve çalışma aralığı kullanıcıya gösterilir. Önizleme her işin önceki/yeni saatlerini ve sığmayanları içerir. Görev tamamlanma durumu ve son tarih değişmez.
- Fatura ve abonelik takibi aylık/yıllık/tek seferlik plan, aylık ve yaklaşan vade toplamları, arşiv ve ödeme beyanı sunar. Ödeme beyanı ile bağlı harcama tek atomik işlemle yazılır. Banka bağlantısı veya gerçek ödeme yoktur. Para birimleri ayrı tutulur. En eski ödenmemiş vade gösterimi tüm geçmiş borçların toplamı değildir. Sonradan düzeltilmiş harcama ve değişmeyen ilk ödeme beyanı ayrı etiketlenir.
- Çevrimdışı bölüm yalnızca açık seçim ve cihaz izniyle en fazla 20 not ve 10 listeyi kopyalar. En fazla 20 yazılı yerel taslak, toplam 1 MiB tutulur. Yeni not, not düzeltme, liste maddesi ve madde durumu desteklenir. Sesli asistan çevrimdışı çalışmaz. Kopya tarihi ve güncel olmayabileceği görünürdür.
- Bağlantı dönüşü hiçbir taslağı kendiliğinden göndermez. İncele düğmesi güncel kayıtla karşılaştırılmış imzalı önizleme oluşturur; ayrı onay kaydeder. Başka cihazdaki değişiklikler çakışma verir; otomatik yeniden temellendirme/üzerine yazma yoktur. Kaybolan yanıttan sonra tekrar gönderim ikinci kayıt oluşturmaz.

## Güvenlik ve maliyet

`0013_replan.sql`, `0014_bills.sql`, `0015_offline.sql` uzaktaki mevcut D1 veritabanına uygulandı. Yeni tablo/kolon ve atomik guard/apply tetikleyicileri mevcut kullanıcı kayıtlarını silmez. HMAC amaçları replan/bills/offline ayrıdır. Önizlemeler yazmaz; tam onay cümlesi, confirmed:true ve sunucu imzası gerekir. CAS/revision/epoch ve değişiklik makbuzları eşzamanlı değişiklikleri ve tekrarlı uygulamayı engeller. Gün planı/fatura/çevrimdışı yeni yolları mevcut oturum, Origin, boyut ve hız kontrollerini kullanır.

Çevrimdışı IndexedDB yalnızca seçilmiş içerik ve yazılı taslak tutar; şifre, oturum, API anahtarı ve imzalı onay belirteci tutmaz. Temizleme nesli geç gelen etkinleştirme isteğinin oturum kapandıktan sonra veri geri yazmasını engeller. Ağ hatası kopyayı korur; doğrulanmış oturum kaybı/çıkış temizler. Bu koşul cihaz izninde açıkça belirtilir. Cihaz kopyası cihazı kullanan kişiler tarafından erişilebilir; şifreli yedek değildir.

Service worker yalnızca altı sabit, herkese açık çevrimdışı sayfa dosyasını anonim isteklerle önbellekler. API, sorgulu URL, OAuth dönüşü ve oturumlu ana uygulama sayfası önbelleğe alınmaz. HTTP hata yanıtları çevrimdışı sayfaya çevrilmez; yalnızca ağ hatası ana gezinmede çevrimdışı sayfayı açar. Kurulum gerçek Chrome'da ardışık dosya alımı ve gövde tüketimiyle doğrulandı. Depolama, kurulum ve ağ işlemleri süreyle sınırlıdır. Cloudflare HTML yönlendirmesi kapatıldı; `/` açıkça `/index.html` dosyasına eşlenir, `/offline.html` doğrudan 200 döner.

Yeni ücretli servis veya metin modeli çağrısı yoktur. Doğal ses mevcut Gemini Live bağlantısını ve kotasını kullanır. Cloudflare Free/D1 kotaları geçerlidir; ücretli plana otomatik geçiş eklenmedi. Resmî sınırlar: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/).

## Doğrulama

- 448 otomatik test geçti. Onay/tahrifat, amaç ayrımı, eski taslak, yarışlar, geri alma uyumu, atomik rollback, kapasite, tekrar, seçili veri gizliliği, oturum temizliği, çevrimdışı depolama ve Service Worker yolları dahil.
- Cloudflare paket kontrolü ve yayın başarılı. Üretim ve localhost üzerinde 13 değişen/yeni dosya kaynakla aynı; güvenlik başlıkları korundu. 12 gruplu yedek, gün planı/fatura kayıtları ve seçimsiz çevrimdışı yanıt iki adreste aynı doğrulandı.
- Üretimde fatura ve çevrimdışı not önizlemeleri alınıp diğer istemcide confirmed:false ile reddedildi. Kayıtlar test öncesi/sonrası değişmedi. Uygulama sırları dışa aktarıma girmedi. Üretime deneme notu/faturası yazılmadı.
- İzole RAM veritabanında Chrome ile fatura oluşturma, ödeme+harcama, saatli görev önizleme/onay; 390 px mobil görünüm; gerçek ağ bağlantısı kesilerek çevrimdışı açılış, seçili kopyalar, yerel not taslağı, sayfa yenileme, bağlantı geri gelince otomatik gönderim olmaması ve açık onay sonrası ortak notta görünme doğrulandı.
- Fiziksel Android mikrofon/hoparlör kontrolü kullanıcı cihazında ayrıca yapılmalıdır. Çevrimdışı seçim her cihaz ve adres için ayrı etkinleştirilir.

Kullanıcı rehberi: `../ATLAS-Gunluk-Denge-Kullanim.txt`.
