# Yapılacaklar ve günlük özet — yayın adayı

24 Ekim 2026: Kullanıcının açık onayıyla mevcut https://atlas-pasam-v1.pages.dev/ adresine yayınlandı. Worker sürümü: 08e2c77d-ce67-4850-ab7f-9eb30ce41fa8. 0002_tasks.sql ortak D1 veritabanına uygulandı. Mevcut kişisel hafıza verileri korunuyor. Bilgisayardaki localhost:8790 sunucusu güncel dosyalarla yeniden başlatıldı. Ücretli plan veya yeni ücretli hizmet açılmadı.

52 test ve yayın paketi kontrolü geçti. Canlı Pages giriş, görev listeleme, günlük özet ve yetkisiz erişim reddi doğrulandı. İlk doğrudan ses isteği 429 sınır yanıtı verdi; bilgisayarın aynı bulut servisine yaptığı kontrolde giriş/liste/özet/ses 200 döndü ve geçerli WAV üretildi. Testler gerçek görev eklemedi veya silmedi. Telefon ve bilgisayarda kullanıcıyla sesli ekleme/tamamlama denemesi bekleniyor. Eski dosyalar work/before-tasks-release altında yedeklendi.

## Komutlar

- Listeye bugün market alışverişi ekle.
- Listeye yarın raporu hazırla ekle.
- Listeye kitap oku ekle. (Tarihsiz)
- Görev 1 tamamlandı. / Görev bir tamamlandı.
- Görev 1 yeniden aç.
- Bugün ne kaldı? / Günlük özet / Günlük özeti oku.
- Görevlerimi oku.

“Atlas” uyandırma modunda bu komutlar mevcut sesli sohbet akışını kullanır. Açılışta mikrofon otomatik başlamaz; istenirse Ses ayarlarından açılır. Metin komutları da aynı işlemleri yapar. Açık ekleme ve tamamlama komutu işlem yetkisidir; ayrıca kaydet düğmesi gerekmez. Normal sohbet görev oluşturmaz. Belirsiz görev adları değiştirilmez; sabit görev numarası istenir. Tamamlama silme değildir ve geri alınabilir.

Günlük özet İstanbul tarihini kullanır. Bugünkü, geçmiş tarihli açık ve tarihsiz işleri kapsar; yarınki işler bugünkü listeye dahil edilmez. En fazla ilk üç iş okunur, kalanların sayısı söylenir. Tam liste Yapılacaklar düğmesindedir. Özet istek üzerine okunur; arka plan bildirimi veya ekran kapalı sesli çalışma eklenmedi.

En fazla 100 toplam görev, görev başına 200 karakter. Aynı açık başlık/tarih tekrar eklenmez. Görev silme özelliği yoktur. Tarih seçimi bu sürümde bugün, yarın veya tarihsizdir. Ücretsiz sınırlar korunur; ek model çağrısı olmadan SQL ile görevler ve özet işlenir. Seslendirme mevcut Gemini ses kotasını kullanır. Sesli okunan metin ses sağlayıcısına gönderilir.

## Kontroller

52 otomatik test: açık komut ayrımı, iki oturumda ortak kayıt, Türkiye gece yarısı ve yıl geçişi, günlük filtreleme, ses uzunluğu, belirsiz başlık, tamamlama/geri alma, yinelenen kayıt ve kapasite, SQL parametreleme, oturum/Origin/hız sınırı, görevlerin kişisel hafızaya karışmaması ve Hey Atlas komut iletimi; mevcut ses/hafıza testleri dahil. Yayın paketi dry-run başarılı. Tarayıcı önizlemesinde giriş, görev ekleme, tamamlama ve yeniden açma doğrulandı. Gerçek cihazlarda ses ve bulut testi yayın onayından sonra yapılacak.

## Yalnızca yayın onayından sonra

1. Canlı dosyalarda sonradan değişiklik olmadığını kontrol et. Bu adaydan yalnızca değişen src/tasks.js, src/worker.js, public/app.js, public/index.html, public/style.css, scripts/shared-api.mjs, migrations/0002_tasks.sql ve ilgili test/belge dosyalarını asıl projeye aktar. Gizli ayarları değiştirme.
2. Asıl projede mevcut Wrangler ile `d1 migrations apply atlas-memory --remote` çalıştır; 0002_tasks.sql yalnızca görev tablosunu/indexini ekler, hafızaya dokunmaz.
3. Testleri ve deploy --dry-run kontrolünü çalıştır, ardından Worker'ı yayınla. Mevcut Pages adresi ve MEMORY_DB bağlantısı korunur.
4. Bilgisayarda yalnızca doğrulanmış local.mjs sürecini yeniden başlat. cloud-memory.json enabled:true korunur.
5. Yetkisiz istek reddini, oturumla boş liste/özet okumasını doğrula. Kullanıcı telefonda gerçek bir görev eklesin, bilgisayarda görüp tamamlasın; telefonda günlük özeti kontrol etsin. Test amacıyla kullanıcının gerçek kayıtlarını silme.
