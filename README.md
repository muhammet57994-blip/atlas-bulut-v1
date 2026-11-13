Güncel sürüm: Günümü toparla, fatura/abonelik takibi, seçime bağlı çevrimdışı kayıtlar, Kodlama Yardımcısı ve cihaz içinde çalışan salt okunur yedek önizlemesi yayında. Canlı yedek önizlemesi ve doğrulama: [BACKUP-PREVIEW-RELEASE.md](BACKUP-PREVIEW-RELEASE.md). Son mobil, araştırma ve mikrofon kontrolleri: [FOLLOW-UP-2026-11-08.md](FOLLOW-UP-2026-11-08.md). Canlı dağıtım kimliği ve doğrulama: [CODE-ASSIST-RELEASE.md](CODE-ASSIST-RELEASE.md). Geri yükleme güvenli tasarımı (yazma/ithal etme henüz uygulanmadı): [RESTORE-DESIGN.md](RESTORE-DESIGN.md). Araştırma kaynak bağlantısı düzeltmesi ve test kapsamı: [RESEARCH-RELEASE.md](RESEARCH-RELEASE.md). Önceki günlük denge yayını: [DAYFLOW-RELEASE.md](DAYFLOW-RELEASE.md). Kullanım: [Türkçe rehber](ATLAS-Gunluk-Denge-Kullanim.txt).

**Test durumu:** 628/628 otomatik test geçti (13 Kasım 2026, `pnpm test`). Aşağıdaki tarihli sürüm notlarındaki sayılar o günkü ölçümlerdir; güncel sayı bu satırdır.

# ATLAS Bulut V1

Son gizlilik güncellemesi: mikrofon açılışta varsayılan olarak kapalıdır; [sesli kullanım notları](VOICE-PRIVACY-RELEASE.md).
Son ana ekran görsel güncellemesi: [durum rozeti, ses eylemleri ve kısa pencere düzeni](VISUAL-RELEASE-2026-11-08.md).
## Web araştırması ve kodlama desteği

Sohbet alanındaki çalışma modu seçicisinden Sohbet, Web araştırması veya Kodlama yardımcısı seçilir. Web araştırması modu yalnızca seçilen istekte Gemini Google Search aracını etkinleştirir; dönen kaynaklar https bağlantıları olarak yanıt altında gösterilir. Normal sohbet ve kodlama modunda web araması etkin değildir. Kaynakların erişilebilirliği ve içerik doğruluğu kullanıcı tarafından ayrıca değerlendirilmelidir; arama sonucu yoksa ATLAS araştırma yaptığını iddia etmemelidir.

Kodlama modu kod örneği, hata açıklaması ve uygulanabilir değişiklik önerileri üretir. Bu sürüm yerel dosyalara erişmez, kod çalıştırmaz, dosya değiştirmez veya dağıtım yapmaz. Kod çıktısı önce incelenip sonra kullanıcı tarafından uygulanmalı ve test edilmelidir.

Kodlama modunda üç ters tırnakla çevrili kod örnekleri ayrı bloklarda ve tek dokunuşla kopyalama düğmesiyle gösterilir. Kopyalama yalnızca kullanıcı düğmeye bastığında cihazın panosuna yazar; dosya değişikliği veya kod çalıştırma yapmaz. Değişiklik önerileri, ilgili dosya içeriği paylaşılmışsa diff, doğrulama ve geri alma adımlarını içerebilir.

Araştırma sorgusu ve sohbet bağlamı Google Gemini/Google Search tarafından işlenir. Google ücretsiz katman ve arama hizmeti koşulları geçerlidir; hassas bilgi göndermeyin. Araştırma çağrıları mevcut sohbet hız sınırını kullanır; ek kota veya ücret garantisi yoktur. Yeni ücretli servis, abonelik, veritabanı veya sır eklenmemiştir.

Kullanıcıya “Efendim” diye hitap eden Türkçe kişisel asistan. Sade koyu ana ekran, RGB ses dalgası, isteğe bağlı yazılı sohbet, Gemini bağlantısı ve güvenli giriş içerir. Eski ZIP’in kopyası değildir; sıfırdan hazırlanmıştır.

## Şu anki durum

### 25 Ekim 2026 — Kayıt düzenleme, listeler/projeler ve yedekler (yayında)

Araçlar → Kayıtlar, listeler ve yedekler bölümünde not, ajanda ve harcamalar düzenlenebilir, arşivlenebilir ve geri getirilebilir. Eski/yeni değerlerin imzalı taslağı açık onay ister: “Değişikliği onaylıyorum”. Kayıt revizyonu ve tam önceki durum hem onaydan önce hem atomik yazımda kontrol edilir. Ajanda çakışma imzası artık id:revision içerir; değişmiş çakışmalar yeni onay ister. Notlarda çok satırlı içerik korunur. Arşivli notlar normal arama/merkezden, arşivli etkinlikler yaklaşan ajandadan çıkar; arşivli harcamalar açıkça belirtilen dönem toplamında kalır. Kalıcı silme yoktur.

Ayrı adlandırılmış listeler ve projelerde miktarlı maddeler, bekliyor/sürüyor/tamamlandı durumları ve ilerleme gösterimi vardır. Oluşturma, ad/madde değişikliği, tamamlama ve arşiv/geri getirme ayrı “Liste değişikliğini onaylıyorum” onayı ister. Tüm liste durumunun revizyonu ve özeti imzaya bağlanır; D1 batch yazım ve geçmişi tek işlemde uygular. Tekrar onay idempotenttir. Her iki değişiklik ailesinde en fazla 5.000 ileri işlem ve her biri için bir geri alma yeri ayrılır; eski kayıtlar otomatik temizlenmez. Son değişikliği geri al komutu iki geçmişin en yenisini seçer; belirsiz eşit zaman veya depolama hatası yazım yapmaz. Geri alma yalnızca bu sürümün kayıt/liste değişiklikleri içindir; eski görev/hafıza/sohbet işlemleri kapsam dışıdır. Yeni liste oluşturmayı geri almak listeyi arşivler. Arşiv dahil 30 liste/proje ve liste başına 100 madde sınırı vardır.

Yedekler, kullanıcı düğmeye bastığında tek atomik D1 okumasından cihazına indirilen dosyalardır. JSON on kişisel kayıt grubunun mevcut durumunu ve arşivlerini; CSV tüm harcamaları; ICS arşivlenmemiş ajandayı içerir. Şema ve alan izin listesi uygulama sırlarını, oturumları, Instagram bağlantısı/istatistiklerini, değişiklik/tamamlama geçmişini ve cihaz tercihlerini dışarıda tutar. JSON otomatik geri yükleme değildir; restoreSupported:false alanı ve arayüz açıklaması bunu belirtir. Eksik/çok büyük/veritabanı hatalı ihracat dosya üretmez. CSV formülleri etkisizleştirilir; ICS metni kaçışlıdır ve satırlar UTF-8 75 bayt kuralıyla katlanır. İndirme bağlantıları değiştirilince, ekran kapanınca veya oturum kapanınca Blob bellekleri bırakılır.

Yeni organize/backup yolları oturum, aynı kaynak, gövde boyutu ve hız kontrolü altındadır. Karışık işlem gövdeleri reddedilir; management/lists/daily/focus imzaları amaç ayrımlıdır. Tüm yeni kayıt/değişiklik/hesaplama/dışa aktarma işlemleri model çağırmaz. Mevcut Gemini Live/Algieba ve ücretsiz servis sınırları korunur; ücretli servis veya abonelik eklenmedi. Masaüstü yalnızca mevcut kanonik Pages adresine ortak API aktarımı yapar.

597 otomatik test geçti. Ayrı RAM deneme ortamında gerçek tarayıcıyla harcama düzeltme/geri alma, proje oluşturma/adım tamamlama ve JSON indirme doğrulandı; 390×844 mobil görünüm incelendi. Üretime test verisi yazılmadı. 0011/0012 şema güncellemeleri uygulandı; sürüm 4455ecc2-89a7-4d24-8cf1-cf3730168979 yayınlandı. Pages ve localhost dosyaları test edilen sürümle birebir eşleşti; iki adresten ortak görünüm ve yedek içerikleri aynı, yetkisiz okumalar ve onaysız liste yazımı engelli, üç ihracat biçimi çalışır. Üretimde düzenlenebilir not/ajanda/harcama bulunmadığından kayıt düzenleme canlı veride denenmedi; test ortamı ve otomatik testlerde doğrulandı. Fiziksel Android mikrofon testi kullanıcı cihazında yapılmalıdır. Kullanım: ../ATLAS-Duzenleme-Listeler-Yedek-Kullanim.txt.

### 25 Ekim 2026 — Saatli ajanda, odak ve harcama defteri (yayında)

Günlük araçlar Araçlar menüsünden veya kişisel merkez kısayollarından açılır. Ajanda ve harcama kaydı, odak başlatma/duraklatma/devam/bitirme işlemleri önce ayrı taslak verir. 30 dakika geçerli HMAC belirteci, amaç ayrımı, tam onay cümlesi ve confirmed:true olmadan yazılmaz. Her istek tek işlem taşır; eski plan/rutin onayları yeni kayıtlarda kullanılamaz. Odak hiçbir görevi otomatik tamamlamaz. Üretim gövdesi kimlik, aynı kaynak, boyut ve hız kontrollerinden geçer.

0009_daily_records.sql ve 0010_focus.sql mevcut D1 deposuna uygulandı. Ajanda 200, harcama 500, odak geçmişi 200 kayıtla sınırlı; geçmiş kayıt silinmez veya üzerine yazılmaz. Ajanda zamanları Türkiye saatiyle doğrulanır, geçmiş saat kendiliğinden yarına taşınmaz. Çakışmalar taslakta gösterilir ve ekleme sırasında atomik olarak tekrar kontrol edilir; diğer cihazda çakışma değişmişse yeni onay gerekir. Harcamalar tam kuruş olarak saklanır; belirsiz binlik ayırıcılar reddedilir, TRY/USD/EUR toplamları ayrı tutulur. Kategori sorgusunun kapsamı açıkça gösterilir.

Ortak depoda aynı anda yalnızca bir bitirilmemiş odak oturumu bulunur. Süre 5–180 dakikadır. Başlangıç ve değişiklikler onay anında uygulanır; süre sunucu zamanından hesaplanır ve planlanan süreyi geçmez. Duraklama süresi eklenmez. Sıralı görev seçimi son imzalı görev listesini ve güncel görev durumunu doğrular; sıra numarası görev kimliği sanılmaz. Günlük toplam, Türkiye tarihine göre o gün başlamış oturumları sayar; bu kapsam ekranda belirtilir. İsteğe bağlı beş dakikalık mola yalnızca bu sekmede tutulur.

/api/daily salt okunur ortak görünümü sunar; görünür ve giriş yapılmış sayfa dakikada bir yeniler. Eski ağ yanıtları yeni onaylanmış durumu geri alamaz. Sayaç yerelde tek yönlü geçen süre kullanır; cihaz saati geri alınca geri sayım artmaz. Ajanda uyarısı açık, görünür sayfada gösterilir; kendiliğinden ses üretmez, dinleme düğmesi mevcut sesi kullanır. Kapalı sayfa/kilitli ekran için alarm garantisi yoktur. Mikrofon yalnızca açık kullanıcı akışında açılır; iptal, çıkış ve gizlenmede durur. Taslaklar kalıcı tarayıcı deposuna yazılmaz.

246 test geçti. Ayrı, bellekte çalışan deneme ortamında gerçek tarayıcıyla ajanda kaydetme, harcamadan vazgeçme/kaydetme ve odak başlatma/duraklatma doğrulandı. Üretim sürümü 2f0c61be-4a84-4541-b3aa-7086f382b02d; mevcut Pages adresi ve localhost dosyaları test edilen sürümle eşleşiyor. Gerçek iki adreste ortak kayıt okumaları, taslak hazırlama, yetkisiz erişim ve onaysız kayıt reddi doğrulandı; üretime test kaydı eklenmedi. Fiziksel Android mikrofon denemesi kullanıcı cihazında yapılmalıdır. Mevcut Gemini Live/Algieba korunur; bu üç aracın kayıt/hesap/sayaç işlemleri model çağırmaz, doğal ses mevcut ücretsiz kotayı kullanır. Yeni ücretli servis veya abonelik yoktur.

Kullanım: ../ATLAS-Gunluk-Araclar-Kullanim.txt.

### 25 Ekim 2026 — Kişisel merkez ve verimli kullanım (yayında)

Kişisel merkez “Merkezimi aç” veya “Kişisel merkezimi aç” ile açılır. “Bana durum özeti ver” ve “Bugün neye odaklanayım” kayıt özetini konuşma içinde verir. Kimlik doğrulamalı `/api/center` mevcut ortak kayıtları yalnızca dört SELECT ile okur; yeni şema, kayıt yazımı veya metin modeli çağrısı yoktur. Açık/gecikmiş görev, not, hafıza, plan ve rutin sayıları ayrı hesaplanır. Türkiye gününe göre gecikmiş, bugün, tarihsiz, gelecek sırasıyla en fazla üç görev; altı rutin ve üç yeni plan gösterilir. Gelecek tarihli işler bugün yapılması gereken işler gibi sunulmaz. Ekran 30 saniyelik oturum içi görünümü yeniden kullanır; Yenile güncel kayıtları okur. Pencere kapandıktan veya çıkıştan sonra gelen eski yanıtlar görünümü geri doldurmaz.

Kişiselleştirme üç renk paleti (Kutup, Nebula, Kehribar), genel/üretici/teknik odak, kısa/dengeli/ayrıntılı cevap tarzı, ferah/kompakt görünüm, 300 veya 600 karakterlik seslendirme sınırı ve en fazla üç favori kısayol sunar. Bu tercihler cihazın tarayıcısında saklanır; telefon ve bilgisayar ortak kayıtları kullanırken tercihlerini ayrı tutar. Tercih değiştirmek model çağırmaz. Cevap tarzı ve odak sıradan sohbet yönergesine aktarılır; mevcut kayıt komutlarını ve onay kurallarını değiştirmez. Uzun yanıtın devamı ekranda kalır. Doğal Algieba sesi ve mevcut ses modeli korunur.

Sıradan metin modeli isteklerinde yalnızca aynı Worker isolate'ında aynı anda süren özdeş çağrılar birleştirilir. Bu küresel veya kalıcı cevap önbelleği değildir; tamamlanan cevabın sonraki istekte yeniden kullanılmasını sağlamaz. Kayıt işlemleri ve onay akışları bu birleştirmeye dahil değildir. Ücretli yedek modele geçiş yoktur; mevcut ücretsiz hesap, model, ses ve istek kotaları sürer. Bir ücretsiz modelin kotası dolduğunda istek sıradaki onaylı ücretsiz modele geçer: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.6-flash` → `gemini-3.8-flash`. Yalnızca 429 (kota) yanıtı modele değiştirir; bozuk anahtar, reddedilen istek ve sunucu hatası ilk denemede durur. Her istek zinciri en fazla bir kez dolaşır, cevap önbelleğe alınmaz ve ücretli model hiç denenmez. `GEMINI_MODEL` bu dört modelden birine ayarlanabilir; başka bir değer 503 ile reddedilir. Merkez okuması ve yerel kişiselleştirme metin üretimi kotası kullanmaz; özeti dinlemek mevcut ses hizmetini kullanır. Taslak açan kısayollar otomatik onay veya kayıt yapmaz.

184 otomatik test geçti. Kayıt sayıları, İstanbul gece yarısı, salt okuma, yerel tercih doğrulama, kısa seslendirme, merkez önbelleği, geç yanıtların atılması ve aynı anda komut çalıştırmanın engellenmesi doğrulandı. Üretim sürümü 93abe286-c5e9-4c28-a13e-9d6aa721a082 olarak yayımlandı. https://atlas-pasam-v1.pages.dev/ ve http://localhost:8790/ dosyaları test edilen sürümle eşleşti. Her iki adreste kimlik doğrulamalı merkez ve komut okuması aynı kayıtları verdi; yetkisiz erişim engellendi. Denemede kişisel kayıt değiştirilmedi. 390 piksel mobil yerleşim tarayıcıda kontrol edildi; fiziksel Android mikrofonu bu turda denenmedi. Kullanım: `../ATLAS-Kisisel-Merkez-Kullanim.txt`.

### 25 Ekim 2026 — Atölye: proje devamı, kişisel rutinler, görsel yardımcı

Atölye `public/companion.js` üzerinden telefon/masaüstü için aynı akışları sunar. “ATLAS projesine devam edelim” veya “Nerede kalmıştık AI Studio” ilgili not, hafıza, onaylı plan ve görevleri okur. Yalnızca konu metniyle eşleşen kayıtlar kullanılır; kaynak türü ve kayıt gösterilir. Sonraki adım önerisi önce okunur, tamamlanma iddiası kayıtların desteklediğiyle sınırlıdır. Model çağrısı yoktur.

`0008_routines.sql` ortak D1 deposuna uygulandı. En fazla 30 rutin, benzersiz ve Türkçe normalleştirilmiş komutla saklanır. “Bu komutu öğren İçerik modunu aç” seçim ekranını açar. Konu ve en fazla üç allowlist adımı seçilir; en fazla biri taslak üretir. HMAC imzalı 30 dakikalık taslak sunucuya kaydedilmez. `routineConfirmation` + `confirmed:true` + tam “Rutini onaylıyorum” ifadesi gerekir. Taslak hazırlama ve kayıt aynı istekte reddedilir. İmza alanı planlardan ayrıdır; idempotent kayıt, sınır, aynı-komut çatışması ve yerleşik komut koruması vardır. Özel komut noktalama işaretleri olmadan da çalışır. Rutin görev/takvim/Instagram değiştiremez. İçerik adımı yalnızca konuyla eşleşen bekleyen takvim kaydını seçer, tek model çağrısı yapar. Oluşan plan için mevcut ayrı onay akışı kullanılır.

`/api/visual/analyze` en fazla iki geçerli JPEG/PNG/WebP, toplam 2 MiB çözülmüş görsel ve 3 MiB istek kabul eder. İstemci 1280 piksel JPEG'e dönüştürür; görseller cihazda hazırlanırken gönderilmez. Açık görüntü+soru gönderim onayı şarttır. Kimlik, Origin, hız, byte sınırı ve biçim imzası doğrulanır. Tek ücretsiz model çağrısı (kota dolarsa sıradaki ücretsiz modele geçer), 25 saniye sınırı; araç, geçmiş, sır, ek kayıt veya ücretli fallback yok. Görsel içindeki talimatlar veri sayılır; belirsiz/okunamayan yerlerin uydurulmaması istenir. Tam yanıt en fazla 3500 karakterdir. Görseller ATLAS tarafından veritabanına yazılmaz; kapatma/çıkış dosya önizlemesini ve yorumu temizler. İstek kapanırken iptal edilir; geç yanıt ve mikrofon callbackleri yok sayılır. Her yeni analiz gönderim onayını sıfırlar.

157 test geçti. İki bağımsız tarayıcı oturumunda onaylı rutin çalıştırma ve ayrıca onay gerektiren plan akışı SQLite ile test edildi. Üretim ve localhost dosyaları eşleşti, gerçek proje sorguları aynı kayıtları verdi, üretimde onaysız rutin denemesi reddedildi ve test rutini kaydedilmedi. Gerçek ATLAS ekran görüntüsünü model doğru yorumladı; “Dinlemeyi durdur” düğmesinin konumunu gösteren yanıt seslendirme akışını tamamladı. 390px telefon görünümü kontrol edildi; fiziksel Android mikrofon denemesi kullanıcı tarafından yapılmalıdır. Yerel köprü yeni görsel rotası ve istek sınırıyla yeniden başlatıldı. Ücretli servis/abonelik eklenmedi; mevcut model ve ses kotaları sürer.

Kullanım: `../ATLAS-Atolye-Kullanim.txt`. Yayın adresi https://atlas-pasam-v1.pages.dev/ ; bilgisayar http://localhost:8790/ . Deneme taslakları onaylanmadan kapatıldı.

### 25 Ekim 2026 — Doğal komutlar, taslak düzenleme, ortak arama, otomatik Hey Atlas

- Doğal komutlar deterministiktir: “İşlerimi oku” ardından “İkinci işi tamamladım”, “İlk işi yarına bırak”. Sunucunun imzaladığı, 10 dakika geçerli son liste sırası kullanılır; model geçmişinden hedef çıkarılmaz. Belirsiz seçimde en fazla beş seçenek sunulur, takip eden sıra sözü yalnızca bekleyen eylemi uygular. Değişmiş görev tekrar seçilmelidir. Tarih/sıra işlemleri mevcut ortak görev kayıtlarına uygulanır.
- Gün planı taslağında çıkarma, sıralama, yeniden adlandırma ve en fazla 10 önceliğe kadar ekleme var. `/api/chat` içindeki `planEdit` doğrulanmış HMAC taslağı işler; veritabanına yazmaz. Asıl kimlik, son kullanma zamanı ve İstanbul günü korunur. Düzenleme ve kaydetme aynı istekte reddedilir. Kaydetme hâlâ açık onay ister. Eski kayıt değişmez; yeni taslak hazırlanır. Arayüz gün planı taslağının düzenlenmesini destekler; içerik/değerlendirme metni düzenlemesi dahil değildir.
- Ortak arama not/hafıza/onaylı plan tablolarını mevcut kayıt sınırları içinde tarar. Türkçe küçük harf ve NFC normalizasyonuyla sözcük dizisi eşleşir; anlamsal model araması değildir. En yeni 8 sonuç, kaynak ve oluşturulma tarihi gösterilir. Tarih aralığı Türkiye saatinde, geçen hafta önceki pazartesi–pazardır. Kullanıcı sorgusu SQL içine eklenmez. Taslaklar aranmaz.
- Bu üç metin işlemi dış model çağırmaz. Seslendirme mevcut Gemini Live ücretsiz kotalarını kullanır. Yeni servis, abonelik, ücretli yedek veya şema değişikliği yok.
- Giriş doğrulanınca görünür sayfada otomatik Hey Atlas beklemesi varsayılan açık. Cihaza özel `atlas-auto-wake=off` tercihi kapatır. Arka planda başlatılmaz; durdurma veya izin hatası sonrası kendiliğinden tekrar başlatılmaz. Chrome otomatik ses engelinde açık tek-dokunuş yönergesi gösterilir; ses açma beklemesi sınırlıdır. Sekme açılışı ekran kilidi/arka plan desteği anlamına gelmez. Ses tanıma tarayıcı sağlayıcısında işlenebilir, uyandırma dışı metin Gemini’ye gönderilmez. Yanıt sırasında mikrofon kapalı kalır.
- 131 test geçti: imza/tarih/bağlam bozma, belirsizlik, aynı kaydın diğer cihazda değişmesi, düzenleme-onay ayrılığı, geç gelen arayüz yanıtı, Türkçe/tarihli arama, oturum/Origin, otomatik açılış ve ses kesilmeme denetimleri dahil. Üretim + localhost dosyaları eşleşti, ortak arama sonuçları eşleşti, imzalı taslak iki adreste düzenlendi, onaysız plan sayısı değişmedi. Dağıtım: `79d3acf5-5e4e-40db-901d-3c7ebfd48a7e`.

Kullanıcı rehberi: `../ATLAS-Yeni-Komutlar.txt`. Tarayıcı sınırı: https://developer.chrome.com/blog/autoplay

- Kullanıcının açık onayıyla ücretsiz planda yayınlandı: https://atlas-pasam-v1.pages.dev/ . Giriş ekranı ve sunucu yapılandırması doğrulandı; Android sesli sohbet denemesi 24 Ekim 2026 tarihinde kullanıcı tarafından başarılı olarak doğrulandı.
- Gerçek Gemini bağlantısı doğrulandı; Windows Chrome üzerinde kullanıcı Hey Atlas denemesinde sesli yanıt aldığını bildirdi. Anahtar güvenli yerel kurulum ekranından kaydedildi.
- `http://localhost:8787` sadece örnek yanıt veren tasarım demosudur.
- `http://localhost:8790` gerçek bağlantı için hazırlanmış Windows sürümüdür. Kurulum bitmeden sohbet açılmaz.
- 31 temel test ve Pages giriş bağlantısına ait 2 test geçti. Android üzerinde Hey Atlas ve sesli sohbet denemesi kullanıcı tarafından başarılı olarak doğrulandı.

## Bilgisayarda ilk kullanım

1. Masaüstündeki **ATLAS KURULUM** kısayolunu açın. Bu kısayol yalnızca bilgisayarınızdaki kurulum sayfasını açar.
2. Google AI Studio hesabınıza kendiniz giriş yapın: https://aistudio.google.com/api-keys
3. Ücretsiz katmanda ve faturalandırması kapalı bir projeden Gemini anahtarı oluşturun. Anahtarı sohbete göndermeyin.
4. Yerel kurulum ekranındaki anahtar alanına girin. En az 20 karakterli ayrı bir ATLAS şifresi seçin.
5. Şifreli kaydettikten sonra ATLAS şifrenizle giriş yapın. İlk gerçek istekte hassas olmayan kısa bir deneme mesajı kullanın.

Windows hizmeti yalnızca `127.0.0.1:8790` adresini dinler; yerel ağa veya internete açılmaz. Windows oturum açılışında başlatma kısayolu kurulmuştur. Tarayıcıyı **ATLAS** masaüstü kısayoluyla açın. Mikrofon ve tarayıcı kendiliğinden başlamaz. Oturum açık değilken, bilgisayar uykudayken veya kapalıyken çalışmaz.

Anahtar ve parola `%LOCALAPPDATA%\ATLAS\secrets.dpapi` dosyasında Windows CurrentUser DPAPI ile şifrelenir. Bu dosya ZIP’e/Git’e dahil edilmez. Aynı Windows hesabı adına çalışan zararlı yazılımlara karşı koruma sağlamaz. Kurulum bağlantısı her hizmet başlangıcında yenilenir. Sayfa yenileyince kurulum bağlantısı geçersiz görünürse masaüstündeki ATLAS KURULUM kısayolunu tekrar açın.

Yerel hizmet PowerShell 7 ve Node.js kullanır. Bu bilgisayardaki başlangıç kısayolu mevcut kurulum yollarına bağlıdır; proje klasörünü taşımayın. Otomatik başlamayı kapatmak için Windows Görev Yöneticisi > Başlangıç uygulamaları içinden ATLAS’ı devre dışı bırakabilirsiniz. Dosya veya yapılandırma silmek gerekli değildir. Bu işlem burada uygulanmadı.

## Sesli kullanım

- **Konuşmayı başlat:** Açıklamayı onaylayıp mikrofon izni verin. Konuşmanız bitince metin otomatik gönderilir; yanıt seçilen tok ve sakin Algieba sesiyle Gemini TTS üzerinden okunur. Normal mod 10 dakikada durur.
- **Atlas ile uyandır:** “Atlas” ile uyandır düğmesine dokunun veya Ses ayarlarında açılışta dinlemeyi özellikle etkinleştirin. Bekleme açıkken “Atlas” deyin; “Hey Atlas” gerekmez. ATLAS “Buradayım Efendim, sizi dinliyorum” der. Ardından komutunuzu söyleyin. “Atlas, bana bir günlük plan hazırla” gibi tek cümle de kullanılabilir. Yanıt sonrası yeniden “Atlas” beklenir.
- Açılışta mikrofon dinlemesi varsayılan olarak kapalıdır. Otomatik başlamasını isterseniz Ses ayarlarından açın; tercih yalnızca o cihazda saklanır.
- Beklemede uyandırma sözü dışındaki tanınan metin Gemini’ye gönderilmez. Ancak tarayıcı sağlayıcısı ses tanıma için sesinizi sunucusuna gönderebilir; bu çevrimdışı veya tamamen yerel bir uyandırma motoru değildir.
- **ATLAS dur**, Durdur düğmesi, Escape veya uygulamanın arka plana geçmesi dinlemeyi kapatır. Yanıt okunurken mikrofon durdurulur.
- **Yazılı sohbet:** Mikrofonu kapatarak aynı konuşmayı yazıyla sürdürebilirsiniz. Yazılı ekrandaki Sesli sohbet düğmesi ana ekrana döndürür; tekrar başlatmak sizin seçiminizdir.
- Ses için cihazda Türkçe ses paketi gerekmez. Gemini 3.8 Flash-Lite TTS ücretsiz katmanı ve Algieba sesi kullanılır. Ses üretimi internet gerektirir; yanıt metni Google’a gönderilir. Ücretsiz kota dolarsa ücretli modele veya yerel robotik sese otomatik geçilmez; ses oturumu durur ve yanıt yazılı kalır.
- RGB dalga animasyonu dinleme/düşünme/konuşma durumunu gösterir; gerçek ses şiddetinin ölçümü değildir.
- Web tarayıcısı kapalıyken veya Android kilit ekranında sürekli “Atlas” algılama garanti edilmez. Bunun için ayrı bir yerel uygulama ve arka plan izinleri gerekir; bu pakette yoktur.

## Android

Android Chrome üzerinde https://atlas-pasam-v1.pages.dev/ adresini açın. Cloudflare'a kaydettiğiniz ATLAS erişim şifresiyle giriş yapın. **“Atlas” ile uyandır > Başlat ve otomatik gönder** adımlarını izleyin ve mikrofon izni verin. “Atlas” deyip kısa bir soru sorun. Otomatik dinleme isterseniz Ses ayarlarından “Açılışta Atlas dinle” seçeneğini etkinleştirin; varsayılan olarak kapalıdır. Menüden **Ana ekrana ekle** seçebilirsiniz. Bu, çevrimdışı çalışan bir Android APK değildir. İnternet, mikrofon izni ve tarayıcı ses oynatma desteği gerekir. Uygulama önde ve ekran açık kalmalıdır. “ATLAS dur” komutu dinlemeyi kapatır.

Pages girişi `pages-entry/` altındadır; Cloudflare service binding ile mevcut `atlas-bulut-v1` Worker'ına bağlanır. Sırlar sadece Worker'da tutulur. Eski workers.dev adresinde bu bilgisayardan bağlantı sıfırlanması gözlendi; pages.dev adresi başarıyla açıldı. Hesabın ortak alt alan adı değiştirilmedi.

## Ücretsiz kullanım sınırı

Hedef Cloudflare Workers Free + Gemini ücretsiz katmanıdır (3.5 Flash-Lite, 3.1 Flash-Lite, 3.6 Flash, 3.8 Flash). Ücretli plana geçiş, ödeme yöntemi bağlama, alan adı satın alma ve ücretli modele otomatik geçiş yapılmaz. Faturalandırmayı kapalı tutmak hesap düzeyinde doğrulanmalıdır; uygulama bunu API anahtarından anlayamaz. Ücretsiz model ve hesap limitleri değişebilir.

- Her yapay zekâ yanıtı en fazla 1024 çıktı tokeni ister. Otomatik yeniden deneme yoktur.
- İstek gövdesi 32 KiB, mesaj 6000 karakter, toplam bağlam 18000 karakter ve 13 mesaj ile sınırlıdır. Eski konuşmalar bağlam sınırına gelince model isteğinden çıkarılır.
- Giriş için 5/dakika, sohbet için 6/dakika sınır vardır. Cloudflare hız sınırları bölgesel ve yaklaşık olduğundan kesin küresel kota/fatura garantisi değildir.
- Gemini ücretsiz katmanındaki içerikler ürün geliştirmede kullanılabilir. Özel belgeler, parolalar veya hassas kişisel bilgiler göndermeyin.

## Geliştirici komutları

Node.js 26.12.1 ve pnpm 12 ile doğrulandı (testler `node:sqlite` kullandığı için Node 22 ve üzeri gerekir); CI aynı sürüme sabitlenmiştir. Üretimde üçüncü taraf JavaScript paketi kullanılmaz; Wrangler yalnızca geliştirme/yayın aracıdır. Kurulumda `--ignore-scripts` kullanılmaz: esbuild ve workerd kurulum betikleri `pnpm-workspace.yaml` içindeki `allowBuilds` ile onaylıdır ve atlanırsa `pnpm test`/`wrangler` çalışmaz.

Komutlar depo kökünde, sırayla çalıştırılır:

```text
pnpm install --frozen-lockfile   # bağımlılıkları kurar (lockfile değişmez)
pnpm test                        # node --test ile 628 testi çalıştırır
pnpm check                       # wrangler deploy --dry-run ile paketi doğrular
pnpm preview                     # node scripts/preview.mjs ile yerel demoyu açar
```

`pnpm test` betiği `node --test` çalıştırır; komutu doğrudan vermek isterseniz depo kökünde `node --test` aynı sonucu verir. Tek bir dosyayı denemek için `node --test test/instagram-oauth.test.js` kullanılır.

Demo parolası `atlas-yerel-demo-2026!` yalnızca yerel örnektir. Demo sunucusu gerçek Gemini’ye bağlanmaz ve yayın paketinin Worker koduna dahil değildir. Masaüstü sürümünü elle başlatmak için PowerShell 7’de `scripts/start-local.ps1` kullanılır; Node yolu bulunmalıdır. Bulut sürümünün yerel denemesinde `.dev.vars.example` dosyasını `.dev.vars` olarak kopyalayıp kendi güvenli yerel ortamınızda doldurun. Gerçek sırları ZIP’e koymayın.

## Sağlık denetimi — `GET /api/health`

Salt okunur ve oturum gerektirmeyen tek uç noktadır: izleme aracı, giriş yapılandırması veya şema eksikken bile sorunun nerede olduğunu görebilsin diye açıktır. Yalnızca `GET` kabul eder ve mevcut sohbet hız sınırını istemci başına `atlas-health@<istemci-IP>` anahtarıyla kullanır; sınır dolduğunda 429 ve “Sağlık kontrolü için bir dakika bekleyin.” döner.

Yanıt alanları: `ok`, `service`, `version`, `ready`, `checkedAt`, `model.{configured,approved}`, `schema.{version,appliedVersion,expectedVersion,upToDate,source,expected,applied,missing,unexpected,migrations{applied,missing,ahead}}`, `db.{reachable,latencyMs}`.

- `ok` yalnızca giriş yapılandırması tam, model onaylı, D1 erişilebilir ve şema güncelse `true` olur; aksi hâlde gövde aynı kalır ve HTTP **503** döner. Böylece aynı adres hem sağlıklı hem arızalı durumda okunabilir.
- `model.approved`, `GEMINI_MODEL` dört onaylı ücretsiz modelden biriyse veya hiç ayarlanmamışsa `true`; başka bir değer `false` olur ve sohbet 503 ile kapalı kalır.
- `schema.source` `d1_migrations` ise sürüm gerçek migration defterinden, `tables` ise tablo varlığından okunur. `missing` eksik migration tablolarını, `unexpected` bu kodun tanımadığı `atlas_*` tablolarını adlarıyla bildirir; `migrations.ahead` bir boşluğun ötesine uygulanmış dosyaları gösterir. Bu yüzden veritabanı koddan ilerideyse `ok:false` olur.
- Kayıt sayısı, kayıt içeriği, sır ve ham veritabanı hata metni hiçbir zaman dönmez; veritabanı hatası yalnızca sunucu günlüğüne yazılır.

Kısaltılmış örnek yanıt:

```text
GET https://atlas-pasam-v1.pages.dev/api/health

{"ok":true,"service":"atlas","version":1,"ready":true,
 "model":{"configured":true,"approved":true},
 "schema":{"version":"0018","upToDate":true,"missing":[],"unexpected":[]},
 "db":{"reachable":true,...},...}
```

## Buluta yayın — yalnızca ayrı ve açık son onaydan sonra

1. Cloudflare hesabına resmî giriş arayüzünden girin; Workers Free planını doğrulayın.
2. Gemini hesabında ücretsiz katmanı ve model erişimini doğrulayın.
3. Bu paketin son sürümünü, herkese açık bir HTTPS adresi oluşacağını ve şifrenin yalnızca sohbet API’sini koruduğunu kullanıcıya gösterin. Açık yayın onayı alın.
4. `pnpm exec wrangler login` ile tarayıcıdan giriş yapın. Anahtarı/şifreyi sohbete veya komut satırına açık yazmayın.
5. Onaydan sonra `pnpm exec wrangler deploy` çalıştırın. İlk dağıtımda sırlar eksik olduğundan sohbet API’si 503 ile kapalı kalır.
6. Cloudflare Workers > ATLAS > Settings > Variables and Secrets alanına `GEMINI_API_KEY`, en az 20 karakterli `ATLAS_ACCESS_PASSWORD` ve en az 32 karakterli rastgele `SESSION_SECRET` değerlerini **Secret** olarak kullanıcı girsin. Yerel Windows şifreli dosyasını buluta yüklemeyin.
7. Gerçek URL’de yanlış/doğru parola, oturum, kota ve tek gerçek Gemini yanıtını kontrol edin. Sonra Android sesli kullanımını kullanıcıyla deneyin.

Güvenli oturum çerezi 1 saat geçerlidir. Parolayı veya SESSION_SECRET değerini değiştirmek eski oturumları geçersizleştirir. Çıkış yapmak tarayıcıdaki çerezi temizler; çalınmış bir çerez sunucu tarafında anında iptal edilemez, süre dolumu veya sır rotasyonu gerekir.

## Dosyalar

- `src/worker.js`: kimlik doğrulama, sınırlar, güvenlik başlıkları, Gemini erişimi.
- `public/`: sade RGB arayüz, yazılı/sesli modlar ve web manifest.
- `scripts/local.mjs`, `scripts/protect.ps1`: Windows yerel hizmeti ve şifreli sır deposu.
- `local/`: yerel güvenli kurulum ekranı; Cloudflare paketine dahil değildir.
- `scripts/preview.mjs`: gerçek yapay zekâ kullanmayan localhost demosu.
- `test/`: güvenlik, oturum ve sesli iş akışı testleri.
- `SECURITY-TEST-REPORT.md`: doğrulama sonuçları ve kalan kontroller.

## Kaynaklar

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://ai.google.dev/gemini-api/docs/pricing
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService

Tasarım araştırmasında Manus (https://manus.im/) ve Claude (https://claude.com/product/overview) ürün akışları incelendi. Son görünüm kullanıcının sade RGB ses dalgası isteğine göre özgün olarak düzenlendi; marka görselleri kopyalanmadı.


## Doğal ses uygulaması

## Instagram ekran görüntüsü analizi

Sesli ana sayfada ve yazılı sohbette “Instagram analizi” düğmesi bulunur. Profil, tarih aralığı görünen istatistikler ve içerik performansından en fazla üç JPG/PNG/WebP seçilir (dosya başına 10 MB, 24 megapiksel sınırı). Tarayıcı görselleri 1800 piksel uzun kenarlı JPEG olarak yeniden oluşturur; dosya metaverileri gönderilmez. Hazırlanan her görsel en fazla 1 MiB olur. Kullanıcı hedefini yazar ve Google Gemini’ye gönderimi açıkça onaylar. Seçim tek başına gönderim yapmaz.

`/api/instagram/analyze` oturum, Origin, 4.3 MB akış sınırı, JPEG imza/boyut denetimi ve mevcut sohbet hız sınırını kullanır. Yalnızca onaylı ücretsiz modeller çağrılır (kota dolarsa zincirdeki sıradaki ücretsiz model); araç, web tarama, Instagram oturumu, kalıcı dosya yükleme veya veritabanı yazımı yoktur. Görseller inline gönderilir. Ücretsiz Google veri işleme koşulları arayüzde belirtilir. 45 saniye sunucu, 50 saniye istemci zaman aşımı vardır; hata halinde aynı modelde otomatik tekrar veya ücretli modele geçiş yapılmaz.

Rapor görülebilen verileri, kanıtlı iyileştirme alanlarını, içerik fikirlerini ve yedi günlük planı içerir; eksik verileri belirtmesi istenir. Bu model yönergeleri hatasız analiz garantisi değildir. Sonuç metni HTML olarak çalıştırılmaz. İlk 600 karakter mevcut Live sesiyle dinlenebilir. Pencere kapanınca veya sayfadan ayrılınca seçilen görseller ve rapor temizlenir; onaysız not veya hafıza kaydı oluşturulmaz. Telefon ve bilgisayardan ayrı analiz başlatılabilir; raporlar cihazlar arasında saklanıp eşitlenmez.

Doğrulama: 66 otomatik test geçti; gerçek Chrome dosya seçimi, cihazda görsel hazırlama, onay ve localhost üzerinden yayın API’sinde örnek istatistik görseliyle gerçek analiz başarıyla tamamlandı. Yayın ve yerel adreslerde varlık erişimi ve oturumsuz istek reddi doğrulandı. Instagram’dan otomatik istatistik çekme bu sürümde yoktur.

### Güncel sürüm: Gemini Live (24 Ekim 2026)

Arayüz yanıt sesini `gemini-3.8-live` / `Algieba` ile üretir. Konuşmayı yazıya çevirme ve Hey Atlas tarayıcıda kalır; `/api/chat` hafıza, onaylı notlar ve görev komutlarını eskisi gibi işler. Live yalnızca hazırlanmış yanıtı seslendirir; kayıt yazma araçlarına erişimi yoktur. Bu sürüm doğrudan mikrofondan çift yönlü Live akışı değildir.

`/api/live/token` oturum, aynı kaynak ve hız denetimi ile tek kullanımlık geçici anahtar üretir. Kalıcı Gemini anahtarı sunucudadır. Geçici anahtar 60 saniyede bağlantı başlatılmasını gerektirir, 10 dakikada biter; model, ses ve sistem yönergesi sunucuda kilitlidir. Aynı bağlantı yanıtlar arasında tekrar kullanılır ve 8 dakika sonrasında yeni yanıt öncesi yenilenir. Yanıt en fazla 600 karakter, ses 2 MiB ve bekleme 45 saniyedir. Ses tamamlanınca oynatılır. Sekme belleğinde en fazla 8 MiB ses önbelleği vardır.

Normal sesli sohbet 30 dakikada kapanır; kullanıcı yeniden başlatabilir. Bekleme modu kullanıcı durdurana veya sayfa arka plana geçene kadar çalışır. Kapanırken Live bağlantısı ve mikrofon durur. Ücretli modele otomatik geçiş veya kota hatasında tekrar döngüsü yoktur. Ücretsiz hizmet sınırsız garantisi değildir; Live ve normal sohbet modelinin limitleri ayrı uygulanır. Eski `/api/speech` uyumluluk uç noktası aşağıda belgelenmiştir; güncel arayüz bunu çağırmaz.

62 otomatik test geçti. Yayın ve localhost üzerinden gerçek Live bağlantısında ikişer yanıt ve bağlantı yeniden kullanımı doğrulandı. Not taslağının onaysız kaydedilmediği yayında doğrulandı. Android cihazda mikrofon ve hoparlör denemesi kullanıcı tarafından yapılmalıdır.

`/api/speech` oturum ve aynı kaynak denetimi gerektirir; dakikada en fazla 6 ses isteği, 600 karakter, 40 saniye üretim zaman aşımı ve 2 MiB WAV sınırı vardır. Üretimde yalnızca `gemini-3.8-flash-lite-tts` ve `Algieba` seçilir; istemci bunları değiştiremez. Otomatik tekrar veya ücretli modele geçiş yoktur. Uzun cevapların ilk bölümü seslendirilir, tamamı yazılı sohbette kalır. Google ses isteğinde `store:false` kullanılır; ücretsiz katmanın veri işleme koşulları ayrıca geçerlidir.

Hey Atlas karşılığı aynı sesle önceden üretilmiş `public/voice-wake.wav` kaydıdır; her uyandırmada üretim kotası harcamaz. Yanıtlar cihazda kalıcı kaydedilmez. Sayfa arka plana geçince, yazılı moda geçince veya Durdur seçilince ses isteği iptal edilir ve oynatma durur. Tarayıcıdaki iptal, Google tarafında başlamış üretimin kotasını geri almayı garanti etmez. Yeni sürüm için sayfayı yenileyin (mevcut sekme konuşması yenilemeyle kaybolur).

### 24 Ekim 2026 — Ortak düzen ve akışlı ses

0006_organizer.sql, görev tekrarını ve tamamlama olaylarını, ortak içerik takvimini ve açık komutla kaydedilen Instagram ölçümlerini ekler. Mevcut kayıtlar silinmez. Günlük/haftalık tekrar tamamlanınca aynı görev kimliğiyle ilerler; eski tamamlama tarihleri uydurulmaz. Haftalık sınırlar Europe/Istanbul kullanır. Takvim 100, ölçümler 30 kayıtla sınırlıdır. Aynı günün ilk ölçümü korunur. Yeni komutlar mevcut kimlik doğrulamalı, Origin ve hız denetimli /api/chat üzerinden çalışır.

Instagram karşılaştırması mevcut iki okuma izniyle son altı medyanın yaşam boyu toplamlarını okur. Eksik metrik null kalır. Aynı medyanın kayıtlı ölçümüne göre fark gösterilir; eşit 72 saatlik sonuç veya nedensel başarı sıralaması iddia edilmez. Karşılaştırma kendi başına yazmaz; kayıt için Instagram ölçümünü kaydet komutu gerekir. Yeni Meta yetkisi, otomatik paylaşım veya mesaj gönderimi yoktur.

Live ses artık doğrulanmış PCM parçaları geldikçe oynatılır; eski tüm-ses-sonra-oynat davranışının yerini alır. Ses modeli ve Algieba korunur. Dokunarak araya girme, opt-in kulaklıkla Hey Atlas kesmesi ve yalnızca sesi yeniden deneyen düğme eklenmiştir. Sesle kesme tam çift yönlü Live görüşmesi değildir; tarayıcı ses tanımasına bağlıdır. Arka plana geçiş, çıkış, iptal ve hata tüm planlanmış ses kaynaklarını durdurur. Otomatik hata tekrarı veya ücretli servis yoktur.

98 test geçti. Yayın ve localhost okumaları, gerçek hesabın altı paylaşım metriği ve gerçek Live parça akışı doğrulandı. Android mikrofon/kulaklık denemesi kullanıcıyla yapılmalıdır. Kullanıcı rehberi: ../ATLAS-Yeni-Ozellikler.txt.

### 24 Ekim 2026 — Onaylı planlar ve yeni araç görünümü

0007_plans.sql ayrı atlas_plans tablosunu ekler (50 kayıt). Günümü planla en fazla üç tarih sıralı öncelik önerir. Haftalık gelişim değerlendirmesi bugün dahil son yedi günün gerçek tamamlama olaylarını, plan tarihlerini ve kayıtlı Instagram ölçümlerini kullanır. Bunlar model çağrısı yapmaz. İçerik paketi yalnızca seçili takvim başlığı/format/tarihini onaylı ücretsiz modellere bir defa gönderir (kota dolarsa sıradaki ücretsiz model); kota veya kesik yanıt onaylanabilir taslak üretmez.

Taslaklar sunucuda yazılmaz. 30 dakika geçerli, ayrı HMAC alanıyla imzalanmış taslak tarayıcı belleğine döner. Kaydetme mevcut /api/chat kimlik, Origin, hız ve boyut denetimlerinden geçer; eşleşen onay komutu, confirmed:true, geçerli imza, aynı İstanbul günü ve geçerli seçimler zorunludur. draft_id benzersizliği çift tıklamada çift kaydı önler. Onay sadece plan tablosuna yazar; görev, takvim ve Instagram durumunu değiştirmez. Onaylanmış plan diğer cihazdan Plan N oku ile okunur. İmza, tarih, seçili alt küme, tekrar, kota, sesli açık onay, arka plan iptali ve iki cihaz testi dahil toplam 110 test geçti.

Planlarım arayüzü Odak/Gelişim/Üretim kartları, mobil tek sütun ve ayrı onay ekranı kullanır. Sesle onayla düğmesi sadece bu taslak için mikrofonu açar; Planı onaylıyorum tam ifadesi gerekir. İptal, arka plan veya zaman aşımı kayıt oluşturmaz. Uzun içeriklerin ilk bölümü sesli okunur. Mevcut dairesel ana ekran korunur; araç pencereleri koyu ve yüksek kontrastlı stile geçirildi.

Yayında ve localhost üzerinden günlük plan/değerlendirme taslakları ile onaysız kayıt oluşmadığı doğrulandı. Gerçek modelle örnek içerik paketi üretildi; üretim testinde gerçek plana kayıt yapılmadı. Android yeni onay akışı kullanıcı cihazında ayrıca denenmelidir. Kullanım: ../ATLAS-Planlarim-Kullanim.txt.

### 25 Ekim 2026 — Hatırlanan oturum

Oturum çerezi ve imzalı belirteç ömrü 1 saatten 30 güne çıkarıldı. Geçerli, aynı kaynaktan /api/session açılış kontrolü 30 günlük süreyi yeniler. Süresi dolmuş, değiştirilmiş veya şifre değişiminden önceki oturumlar yenilenmez. Eski 1 saatlik oturum halen geçerliyse açılışta yükseltilir. Secure/HttpOnly/SameSite=Strict korunur; şifre tarayıcı depolarına yazılmaz. Çıkış çerezi siler. Telefon ve localhost ayrı tarayıcı/site oturumlarıdır. Çerez temizleme, gizli pencere veya 30 gün kullanmama tekrar giriş gerektirir. 112 test geçti; süre ilerletme, yenileme, süre dolması, çıkış ve şifre değişimi dahil.

### 25 Ekim 2026 — Tek dokunuş ve mikrofon/ses geçişi

Ana ekrandaki Konuşmayı başlat ve Hey Atlas düğmeleri ara seçenek ekranı olmadan başlatır. Mikrofon ve otomatik gönderim bilgisi ana ekranda kalır; isteğe bağlı kulaklık ayarı Ses ayarları düğmesinden açılır. Tarayıcı mikrofon izni bypass edilmez.

Gönderim ve seslendirme öncesinde eski SpeechRecognition oturumunun dinleyicileri kaldırılır. Her callback aktif oturum kimliğini kontrol eder; geç gelen hata, sonuç veya end olayı yeni yanıtı kesemez. İsteğe bağlı konuşurken dinleme hatası yalnızca o özelliği kapatır, oynayan cevabı durdurmaz. Yanıt tamamlanınca dinleme yeniden başlar. 115 test geçti; tek dokunuş, çift başlatma, gönderim sonrası geç olaylar ve kesme mikrofonu arızası regresyonları dahil. Her iki adreste yayımlanan app.js yerel test edilen sürümle aynı doğrulandı. Android gerçek mikrofon denemesi kullanıcıyla yapılmalıdır.

### 25 Ekim 2026 — Yanıt sırasında dinleme kapalı

Kullanıcı isteğiyle sesli araya girme tamamen kaldırıldı. Ses hazırlanırken ve oynarken SpeechRecognition kapatılır; eski kulaklık tercihi artık okunmaz. Hey Atlas yalnızca dinleme aşamasında çalışır. Cevap bitince mikrofon yeniden açılır; kullanıcı düğmeyle sözünü kesebilir. Önceki kulaklıkla sesli kesme yönergeleri bu sürümde geçersizdir. 115 test geçti; eski tercih açık olsa bile yanıt sırasında tanıma başlatılamaması, sesli komutların cevap sırasında işlem yapmaması ve yanıt sonunda dinlemeye dönüş doğrulandı.

## Bütçem, Beklediklerim ve Birlikte yap — kullanım kapsamı

Bu bölüm kullanım kapsamını açıklar; yayın veya test sonucu bildirimi değildir. Araçlar’daki “Bütçem, beklediklerim ve birlikte yap” düğmesi ve Merkez’in üç ayrı kısayolu yeni ekranları açar. Ayrıntılı Türkçe rehber: [Bütçe, beklenenler ve çoklu işlem](../ATLAS-Butce-Beklenenler-Coklu-Islem.txt). Kanonik telefon adresi https://atlas-pasam-v1.pages.dev/ ; mevcut yerel başlatıcıyla masaüstü http://localhost:8790/ . Mobilde yeni görünüm için sayfayı yenileyin.

- **Bütçe:** “Bu ay market için 5000 lira bütçe ayır.” Ay/kategori/para birimi bazında limit, güncel harcama, kalan ve aşım gösterilir. Dövizler ayrı tutulur, sonraki aya limit veya bakiye devretmez. Arşivli harcamalar da toplama dahildir. Bütçe arşivi aktif limiti kaldırır, harcamayı silmez. Açık onay: “Bütçe değişikliğini onaylıyorum”.
- **Beklenenler:** “Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim.” Yanıt/teslimat, isteğe bağlı takip ve son iletişim tarihi, bekleniyor/alındı/iptal durumu ve arşiv desteklenir. Manuel kişisel listedir; kargo API’si, mesaj gönderme veya kapalı sayfa alarmı yoktur. Açık onay: “Beklenen kaydını onaylıyorum”.
- **Birlikte yap:** “Birlikte yap: yarın sunumu hazırlamayı görev yap; not al: demo bağlantısını paylaş.” Yalnızca 2–5 yeni not/görev/ajanda/harcama hazırlanır; düzenleme, hafıza, bütçe ve beklenen işlemleri bu akışa dahil değildir. Önizleme kutuları başlangıçta seçili değildir; kullanıcı en az birini seçer. Açık onay: “Seçtiğim işlemleri onaylıyorum”. Yalnız seçilen alt küme atomik uygulanır; aynı taslak ve seçim tekrarında ikinci kopya oluşturulmaz. Anlaşılamayan bölümler kısmi uygulamaya dönüşmez.

ATLAS “Efendim” hitabını ve mevcut ses sistemini korur. Manuel okumalar otomatik seslendirilmez; sesli komut ve açık dinleme isteği sesli özet verir. JSON yedek artık bütçeler ve beklenenler dahil 14 veri grubunun mevcut/arşiv durumunu kapsar; otomatik geri yükleme yoktur. Mevcut ücretsiz altyapı ve kotalar kullanılır; yeni ücretli servis eklenmez.
